# 경건생활점검 — 데이터·API 계약 (v1 확정)

> 이 문서가 프론트엔드·백엔드·테스트의 **단일 기준**이다. 임의 변경 금지 (CLAUDE.md 규칙).
> 시니어 검토(2026-07-18) 반영: C1(지표 정의), C2(날짜 통일·미래 금지), C3(토큰 email만 신뢰),
> R1(헤더명 읽기), R2(후행 윈도우), R3(캐시 축소), O1(백필 축소), O2(히트맵 제외).

## 1. 표준 날짜 규칙 (C2)

- 표준 "오늘" = **Asia/Seoul 기준 `YYYY-MM-DD` 문자열**. 이 값 하나에서 맥체인 본문 조회와 기록 대상 날짜를 모두 파생한다.
- 프론트: `new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date())` — 브라우저 로컬 TZ 사용 금지.
- GAS: `Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd')`.
- RECORDS의 날짜 컬럼은 항상 `YYYY-MM-DD` 문자열로 기록하되, 읽을 때는 Date 객체로 돌아오는 셀도 처리한다(`formatDate_` 유틸).

## 2. 시트 스키마

시트 읽기는 **항상 헤더 이름 기반**(R1). 열 순서·삽입에 의존하지 않는다.

### MEMBERS
헤더: `email | 이름 | role | 파트 | active`
- role: `student` \| `teacher` \| `admin` (v1에서 admin=teacher 동일 취급)
- active: 빈 값은 active로 간주, `FALSE/NO/0/N`만 비활성 (출석부 `isActive_` 규칙)
- 등재되지 않았거나 비활성이면 모든 액션에서 `unauthorized`
- **스코핑**: v1에서 teacher/admin은 활성 학생 **전원**의 기록을 조회한다(찬양팀 단일 팀 전제). 명시적 결정 사항.

### RECORDS (1행 = 학생 1명의 하루, `(날짜, email)` 유니크 upsert)
헤더: `날짜 | email | 이름 | 말씀읽음 | 와닿은말씀 | 결단 | 수련회기도 | 기록시각 | 수정시각`
- 말씀읽음/수련회기도: `TRUE`/`FALSE` 문자열. 와닿은말씀/결단: 자유 텍스트(빈 값 허용, `sanitizeCell_` 적용 필수).
- email·이름은 **검증된 토큰의 email과 MEMBERS에서 조회한 이름으로만** 서버가 채운다. 클라이언트가 보낸 email/name은 무시한다 (C3).
- 기록시각: 최초 생성 시각(ISO), 수정시각: 마지막 upsert 시각(ISO).
- upsert는 단순 스캔+append/update (인덱스 캐시 없음, R3/O3).

## 3. 지표 정의 (C1)

- **기록한 날** = 해당 날짜 행의 `말씀읽음 = TRUE`. (텍스트·수련회기도만 있는 날은 미포함)
- **streak** = 표준 오늘부터 거슬러 올라가며 `말씀읽음=TRUE`가 연속인 일수. 오늘 미기록이면 어제부터 센다(오늘은 아직 기회가 있으므로 끊지 않음).
- **주간 달성률** = 이번 주(월~일, KST) 경과 일수 중 기록한 날 비율.
- **월간 달성률** = 이번 달 경과 일수 중 기록한 날 비율.
- **수련회 기도**는 별도 카운터: "최근 7일 중 n일 기도" — streak·달성률에 미포함.

## 4. GAS API

요청: `POST {GAS_URL}`, body = `JSON.stringify({action, idToken, ...payload})`, `Content-Type: text/plain;charset=utf-8` (CORS preflight 회피)
응답: `{ok:true, ...}` / `{ok:false, code, message?}`

| 액션 | 파라미터 | 응답 | 권한 |
|---|---|---|---|
| `whoami` | — | `{ok, email, name, role, part}` | MEMBERS 등재+active |
| `getMyRecords` | — | `{ok, rows:[{date, wordRead:bool, verse, resolution, retreatPrayer:bool, updatedAt}]}` — 본인 전체 행 (연 단위 파라미터 없음, R2) | 본인 |
| `setRecord` | `date, wordRead:bool, verse:str, resolution:str, retreatPrayer:bool` | `{ok:true}` | 본인. **date는 표준 오늘 또는 어제만 허용**(미래·2일 이전 → `bad_request`) (C2/O1) |
| `getAllRecords` | `days?` (기본 60, 최대 366) | `{ok, rows:[{date, email, name, wordRead, verse, resolution, retreatPrayer, updatedAt}]}` — 표준 오늘 기준 후행 days일 | teacher/admin |
| `getMembers` | — | `{ok, members:[{email, name, role, part}]}` — 활성 학생만 | teacher/admin |

- 에러 코드(출석부 동일 체계): `unknown_action, server_error, no_token, server_misconfig, invalid_token, tokeninfo_failed, aud_mismatch, iss_mismatch, token_expired, email_unverified, unauthorized, forbidden, bad_request`
- 쓰기(`setRecord`)는 `LockService.getScriptLock().waitLock(15000)`.
- 서버 캐시: `getAllRecords`만 CacheService 5분 (`setRecord` 시 무효화). 그 외 서버 캐시 없음 (R3).
- 인증: 출석부 Auth.gs 패턴 그대로 — tokeninfo 검증(aud/iss/exp/email_verified) + 토큰 다이제스트 5분 캐시 + MEMBERS 조회.

## 5. 프론트엔드 모듈 계약

### `web/index.html`
- `window.APP_CONFIG = { GAS_URL, OAUTH_CLIENT_ID, MOCK }` — MOCK=true면 GIS 로그인 스킵하고 mock 사용자로 진입(개발·E2E 전용), GAS_URL은 mock 서버 주소 사용.
- API 헬퍼·캐시(TTL 2분)·`WRITE_INVALIDATES`(`setRecord` → `getMyRecords`,`getAllRecords`)·`app:session-expired` 처리: 출석부 `callApiRaw_` 패턴.

### `web/mccheyne-plan.js`
- `window.MccheynePlan.getReadings(dateStr)` → `{ day: 1~365, family: [string, string], secret: [string, string] } | null`
- 본문 표기는 한국어 성경 책명 + 장. 예: `"창세기 1장"`, `"시편 119:1-24"`.
- 2/29는 2/28과 동일 본문. 판본: 클래식 맥체인(1842) family/secret 4본문 체계.

### `web/dev-stats-utils.js` (순수 함수, `window.DevStatsUtils`, Node 테스트 가능하게 IIFE)
- `computeStreak(rows, todayStr)` → number (§3 정의)
- `weeklyRate(rows, todayStr)` / `monthlyRate(rows, todayStr)` → `{done, total, pct}`
- `retreatPrayerCount(rows, todayStr, days=7)` → number
- `encourageMessage(rows, todayStr)` → `{tone: 'praise'|'nudge'|'strong'|'milestone', text}`
  - 규칙: 오늘 기록 완료→praise / 오늘 미기록(공백≤2일)→nudge / 3일 이상 공백→strong / streak 7·14·30 도달→milestone 우선.
  - 메시지 풀에서 날짜 문자열 해시로 결정적 선택(테스트 가능).

## 6. 화면 (디자인 = 출석부 Montage 토큰 전체 복사, R9)

| 탭 | 내용 |
|---|---|
| 오늘 | 표준 오늘 날짜 + 맥체인 본문 4개(가정/개인 구분) 카드, 말씀읽음 체크(pill), 와닿은말씀 textarea, 결단 textarea, 수련회기도 체크(pill), 저장. "어제 기록" 전환 링크(오늘/어제 2개만, 스테퍼 없음) |
| 나의 현황 | streak 카드, 주간/월간 달성률, 수련회기도 카운터, 독려 메시지 배너, 최근 기록 리스트(카드, 탭→상세). 히트맵 없음(O2) |
| 우리팀 | (teacher/admin만) 학생별 최근 7일 ○/× 그리드 + streak/달성률 요약, 학생 탭→상세 기록 바텀시트 |

- 도메인 4색: `--dev-read`=green(말씀읽음), `--dev-verse`=blue(와닿은말씀), `--dev-resolve`=violet(결단), `--dev-prayer`=orange(수련회기도).

## 7. 자가 등록 (v1.1, 2026-07-19 시니어 검토 반영 확정)

### Script Property `REGISTER_CODE`
- 팀 등록 코드. Setup.gs `setupAll()`이 미설정일 때만 기본값을 넣는다(운영 중 변경값 보존).
- **빈 값/미설정이면 등록 폐쇄**: `register`는 `registration_closed`, `whoami.canRegister`는 false (C-2).

### `whoami` 변경 (하위호환 additive)
- 미등재(`unauthorized` 코드 경로에만): `{ok:false, code:'unauthorized', email, canRegister:bool}`
- `canRegister` = `REGISTER_CODE`가 trim 후 길이>0. 다른 에러 코드(token_expired 등)에는 부착하지 않는다.

### 신규 액션 `register`
- 파라미터: `name`(필수), `part`(선택), `code`(필수)
- 검증 순서: idToken 검증(실패 시 해당 에러) → 백오프 검사 → 코드 대조 → 중복 검사 → append
- **코드 비교 정규화 (R-2)**: 양쪽 모두 trim + 소문자화 + 내부 공백 제거 후 비교. 불일치 → `bad_code`
- **백오프 (R-1)**: email 키 CacheService 카운터 — 10분 창에서 `bad_code` 5회 초과 시 `too_many_attempts`
- **중복 검사 (C-1)**: `lookupMember`를 쓰지 않는다. MEMBERS **원시 스캔**(active 무관, email 대소문자 무시)으로:
  - 활성 행 존재 → `already_registered` / 비활성 행 존재 → `deactivated`(재가입으로 활성화 불가 — 교사만 복구) / 없음 → append
  - **스캔→append 전체를 LockService 잠금 안에서** 수행 (중복 가입 레이스 방지)
- **이름 검증 (R-4)**: trim 후 빈 값 거부, 개행·제어문자 제거, 코드포인트 ≤30자(part ≤20자), 초과/누락 → `bad_request`, `sanitizeCell_` 적용
- **서버 강제 불변식**: 기록 행은 `[토큰 email(소문자), name, 'student', part, 'TRUE']` — 클라이언트의 role/active/email은 무시
- 성공 응답: `{ok:true, email, name, role:'student', part}` (whoami 성공과 동일 shape — 프론트는 이 응답으로 바로 진입 가능, R-5)

### 프론트 (§6 확장)
- 미등재 & `canRegister` → **RegisterScreen**: 로그인 email 표시, 이름(필수)·파트(선택)·등록 코드 입력, 등록 버튼(전송 중 disable — 더블서브밋 방지), 에러별 안내(bad_code/deactivated/too_many_attempts/registration_closed)
- 미등재 & !canRegister → 기존 안내 화면 유지 (구백엔드와도 자연 호환)
- 우리팀 학생 상세 바텀시트 헤더에 email 병기 (동명이인·사칭 구분, R-4)

### 배포 순서 (C-3)
1. GAS: 코드 반영 후 **반드시 "배포 관리 → 기존 배포 수정 → 새 버전"** (새 배포 금지 — URL이 바뀌면 프론트가 구 백엔드를 호출)
2. 프론트 push (Pages 자동 재배포)

### v1.1 백로그 (감사 흔적, R-3)
- MEMBERS에 `가입시각`/`가입경로(self|admin)` 컬럼 추가는 차기 버전에서 검토. 현재는 자가등록분 구분 불가함을 운영 문서에 명시.
