# 경건생활점검 구현 계획 (2026-07-18)

> **시니어 검토(조건부 승인) 반영 완료.** 세부 계약은 `docs/specs/2026-07-18-api-contract.md`가 본 문서보다 우선한다.
> 주요 조정: 기록/streak = 말씀읽음 기준(수련회기도 분리), 표준 날짜 = Asia/Seoul 문자열 통일,
> setRecord는 오늘·어제만(미래 금지), 서버는 토큰 email만 신뢰, 히트맵·주간 스테퍼·서버 인덱스 캐시 제외,
> getMyRecords는 연 단위 대신 본인 전체 반환.

## 1. 목표

혜림교회 청소년부 **찬양팀** 구성원이 매일 경건생활을 기록·점검하는 웹앱.
참고 저장소(kyuils/youth_group 출석부)와 **동일한 아키텍처·디자인 시스템**을 사용한다.

### 요구사항 (고정)
| # | 기능 |
|---|---|
| R1 | 오늘 날주(맥체인 성경일기 본문) 말씀을 읽었는지 체크 |
| R2 | 와닿은 말씀 구절 기록 (텍스트) |
| R3 | 그 말씀으로 오늘을 어떻게 지낼지 결단 기록 (텍스트) |
| R4 | 수련회를 위한 기도 여부 체크 |
| R5 | 자기 경건생활 현황 대시보드 (연속 기록 streak, 주간/월간 달성률) |
| R6 | 기록 안 하면 독려 메시지 표시 |
| R7 | 교사(관리자)가 담당 학생들의 기록 조회 |
| R8 | 데이터는 Google Sheets에 저장 |
| R9 | 디자인은 출석부와 동일 |

## 2. 아키텍처 (출석부와 동일)

```
[브라우저: web/index.html — React 18 UMD + Babel Standalone, GitHub Pages]
        │  fetch POST (Content-Type: text/plain — CORS preflight 회피)
        ▼
[GAS 웹앱: gas/Code.gs(라우터) + Auth.gs(인증) + Sheet.gs(I/O) + Actions.gs(핸들러)]
        │  SpreadsheetApp
        ▼
[Google Sheets: MEMBERS / RECORDS 탭]
```

- 인증: Google Identity Services ID Token → GAS가 `tokeninfo`로 검증 → MEMBERS 시트에서 역할 조회. sessionStorage에 토큰 보관, 만료 시 `app:session-expired` 이벤트. (출석부 Auth.gs 패턴 그대로)
- 설정: GAS Script Properties에 `SHEET_ID`, `OAUTH_CLIENT_ID`. 프론트 `window.APP_CONFIG`에 `GAS_URL`, `OAUTH_CLIENT_ID` (placeholder로 두고 배포 문서에서 안내).
- 쓰기 액션은 `LockService` 잠금. 셀 값은 `sanitizeCell_`로 수식 인젝션 방어. (출석부 패턴 그대로)

## 3. 시트 스키마

### MEMBERS 탭
| email | 이름 | role | 파트 | active |
|---|---|---|---|---|
| gildong@gmail.com | 홍길동 | student | 싱어 | TRUE |
| teacher@gmail.com | 김교사 | teacher |  | TRUE |

- role: `student` \| `teacher` \| `admin` (admin은 teacher 권한 + MEMBERS 관리. v1에서는 teacher와 동일 취급)
- 학생 본인 기록만 읽기/쓰기 가능. teacher/admin은 전체 학생 기록 읽기 가능(쓰기는 본인 기록만).

### RECORDS 탭 (1행 = 한 학생의 하루 기록, `(날짜, email)` 유니크 upsert)
| 날짜 | email | 이름 | 말씀읽음 | 와닿은말씀 | 결단 | 수련회기도 | 기록시각 | 수정시각 |
|---|---|---|---|---|---|---|---|---|
| 2026-07-18 | gildong@… | 홍길동 | TRUE | 시 23:1 여호와는 나의 목자시니… | 오늘 하루 불안 대신… | TRUE | ISO | ISO |

- 말씀읽음/수련회기도: `TRUE`/`FALSE` 문자열. 와닿은말씀/결단: 자유 텍스트(빈 값 허용).
- "기록함" 판정: 해당 날짜 행이 존재하고 (말씀읽음=TRUE 또는 와닿은말씀/결단/수련회기도 중 하나라도 채움).

## 4. GAS API 계약 (docs/specs로 확정, 프론트·백 공통 기준)

요청: `POST {GAS_URL}` body=`JSON.stringify({action, idToken, ...payload})`, Content-Type `text/plain;charset=utf-8`
응답: `{ok:true, ...}` / `{ok:false, code, message?}` — 에러 코드는 출석부와 동일 체계.

| 액션 | 파라미터 | 응답 | 권한 |
|---|---|---|---|
| `whoami` | — | `{ok, email, name, role, part}` | 로그인 (MEMBERS 등재 + active) |
| `getMyRecords` | `year?` (기본 올해) | `{ok, year, rows:[{date, wordRead, verse, resolution, retreatPrayer, updatedAt}]}` | 본인 |
| `setRecord` | `date, wordRead:bool, verse:str, resolution:str, retreatPrayer:bool` | `{ok:true}` | 본인 기록만. date는 오늘±7일 이내만 허용 |
| `getAllRecords` | `year?` | `{ok, year, rows:[{date, email, name, wordRead, verse, resolution, retreatPrayer, updatedAt}]}` | teacher/admin |
| `getMembers` | — | `{ok, members:[{email, name, role, part}]}` (active 학생만) | teacher/admin |

- 캐시: 프론트 인메모리 캐시(TTL 2분) + `setRecord` → `getMyRecords`/`getAllRecords` 무효화 (출석부 `WRITE_INVALIDATES` 패턴).

## 5. 프론트엔드 화면 구성 (web/index.html 단일 파일)

출석부의 셸 구조 그대로: `LoginScreen`(표지: 다크 히어로 + Noto Serif KR 제목 + GIS 투명 오버레이 버튼) → `App` → `Shell`(앱바 + 상단 탭 + 다크모드 토글).

| 탭 | 컴포넌트 | 내용 |
|---|---|---|
| 오늘 | `TodayView` | 오늘 날짜·맥체인 본문 4개 표시(내장 365일 테이블), R1 읽음 체크(pill 토글), R2 와닿은 말씀 textarea, R3 결단 textarea, R4 수련회 기도 체크, 저장 버튼. 지난 날짜(최대 7일 전) 선택해 보완 기록 가능(`WeekStepper` 유사 데이트 스테퍼) |
| 나의 현황 | `MyStatsView` | R5: 연속 기록 streak 카드, 이번 주/이번 달 달성률, 최근 4주 캘린더 히트맵(4항목 색 매핑), 최근 기록 리스트(날짜별 카드, 탭하면 상세). R6: 오늘 미기록/공백 일수에 따른 독려 메시지 배너 |
| 우리팀 | `TeacherView` (teacher/admin만 탭 노출) | R7: 학생별 최근 7일 기록 현황 그리드(○/×), streak·달성률 요약, 학생 탭 → 상세 기록 시트(바텀시트) |

- 도메인 4색 매핑 (출석부 `--att-*` 패턴): `--dev-read`(green)=말씀읽음, `--dev-verse`(blue)=와닿은말씀, `--dev-resolve`(violet)=결단, `--dev-prayer`(orange)=수련회기도.
- CSS는 출석부 `:root` Montage 토큰 블록 **전체 복사** + 라이트 코랄/크림 오버라이드 레이어 + 컴포넌트 스타일(카드/필/바텀시트/토스트/앱바/탭) 재사용. → R9 충족.
- 독려 메시지 규칙(순수 함수로 분리, 단위 테스트): 오늘 기록 완료 → 칭찬 / 오늘 미기록 → 독려 / 3일 이상 공백 → 강한 독려 + 재시작 응원 / streak 7·14·30일 → 축하. 메시지 풀에서 날짜 기반 결정적 선택.
- 맥체인 본문: `web/mccheyne-plan.js` — 365일×본문 배열, `window.MccheynePlan`으로 노출. `Date` → 해당일 본문 조회(윤년 2/29는 2/28과 동일 처리 또는 전용 항목).

## 6. 검증 계획

| 검증 | 도구 | 내용 |
|---|---|---|
| V1 | `scripts/check-web.mjs` | babel 블록 JSX 문법 esbuild 검증 (출석부 스크립트 이식) |
| V2 | `scripts/test-gas-actions.mjs` | GAS 파일들을 Node에서 로드(모의 SpreadsheetApp/Properties/Lock/Cache/UrlFetchApp) → whoami/getMyRecords/setRecord(upsert·권한·날짜 검증)/getAllRecords/getMembers 단위 테스트 |
| V3 | `scripts/test-stats-utils.mjs` | streak/달성률/독려 메시지 순수 함수 단위 테스트 |
| V4 | `scripts/mock-server.mjs` + 브라우저 | 모의 GAS API 서버(mock 모드: `APP_CONFIG.MOCK=true`면 GIS 스킵) → 실제 브라우저에서 로그인→기록 저장→대시보드 반영→교사 조회 E2E 확인, 데이터가 mock 저장소에 올바른 스키마로 기재되는지 확인 |
| V5 | verifier 에이전트 | V1~V3 실행 증거 수집, 요구사항 R1~R9 대조 |
| V6 | 하네스 | `/harness`로 Stop 훅 = V1+V2+V3 게이트 설치 |

실제 Google Sheets 기재는 사용자의 Google 계정(GAS 배포)이 필요하므로, **모의 환경에서 스키마·로직을 완전 검증**하고 실 배포 절차는 docs/ops 문서로 제공 (출석부와 동일한 방식).

## 7. 실행 순서 (병렬화)

```
[완료] 탐색(Explore/sonnet) → 계획(본 문서) → 시니어 검토(opus)
  ↓ 계약 확정 후 병렬:
  A. GAS 백엔드 + V2 테스트         (sonnet)
  B. 프론트엔드 web/index.html + V3  (opus — 디자인 복제 정밀도)
  C. 맥체인 365일 데이터 생성·검증    (sonnet, 웹 자료 대조)
  D. 배포 문서 docs/ops             (haiku/sonnet)
  ↓ 합류:
  V1~V4 실행 → code-reviewer 리뷰 → 오류 시 시니어(opus) 원인 분석·수정 계획 → 수정 → 재검증
  → 하네스 설치 → verifier 최종 확인 → 커밋
```

## 7.5 코드 리뷰 후속 (2026-07-19)

리뷰 발견 8건 중 5건 수정 완료(파일 평가 순서 독립화, role 정규화, unauthorized email 포함,
엄격 bool 판정, 팀 streak 60+ 표시). 아래 3건은 시니어 판정에 따라 v1 수용 — **v2 백로그**:
- B1. 모의 sanitizeCell이 실제 Sheets의 선행 `'` 소비를 재현하지 않음 (테스트 충실도만의 문제)
- B2. getAllRecords 응답에 비활성 학생·교사 본인 행 포함 (UI 미표시, teacher 권한 내 데이터)
- B3. getAllRecords 캐시 95KB 초과 시 스킵 → 풀스캔 (10~30명 규모에선 연말에도 1~2초 수준)

## 8. 리스크

1. **맥체인 데이터 정확성**: 365일×4본문을 내장 — 공개 자료와 대조 검증 필수. 오류 시 앱 신뢰도 하락. 완화: C 에이전트가 2개 이상 출처 대조 + 샘플 스팟체크. 실패 시 폴백: 본문 미표시(체크 기능은 유지).
2. **학생 Google 계정 부재 가능성**: 청소년 대부분 Google 계정 보유 가정. 없으면 계정 생성 안내(배포 문서에 명시).
3. **GAS 미배포 상태의 검증 한계**: 모의 검증으로 로직은 보장하나 실환경(권한, 시트 형식)은 배포 후 docs/ops 체크리스트로 확인.
4. **단일 파일 프론트 규모**: 출석부보다 화면이 적어(3탭) 관리 가능 범위.
