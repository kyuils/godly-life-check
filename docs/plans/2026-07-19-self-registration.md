# 자가 등록(Self-Registration) 구현 계획 (2026-07-19)

> **시니어 검토(조건부 승인) 반영 완료.** 확정 계약은 `docs/specs/2026-07-18-api-contract.md` §7이 우선한다.
> 반영: C-1(원시 스캔+락 — 비활성 밴 우회 차단), C-2(빈 코드 등록 폐쇄), C-3(같은 배포 새 버전 재배포),
> R-1(백오프 too_many_attempts), R-2(코드 정규화 비교), R-4(이름 서버 강화 + 상세 시트 email 병기),
> R-5(register 응답으로 직접 진입 + 더블서브밋 방지), R-6(에러코드 계약 명시). R-3(감사 컬럼)은 v1.1 백로그.

## 1. 요구사항 변경

기존: 관리자가 MEMBERS 시트에 이메일을 사전 등록해야만 로그인 가능 (미등재 → "접근 권한이 없어요").
변경: **사용자가 자신의 Google 계정으로 로그인 후 직접 등록(가입)하고 즉시 사용**할 수 있다.

## 2. 보안 설계 결정 (핵심 쟁점)

완전 개방 가입은 무관한 외부인이 명단을 오염시킬 수 있다(교사 화면에 노출). 검토한 3안:

| 안 | 장점 | 단점 |
|---|---|---|
| A. 완전 개방 | 마찰 최소 | 아무나 가입 → 명단 오염 |
| B. 교사 승인 대기 | 통제 최강 | 교사 운영 부담, 학생 즉시 사용 불가 |
| C. **등록 코드(팀 코드)** ← 채택 | 마찰 낮음(코드 1회 입력), 외부인 차단, 즉시 사용 | 코드 유출 시 가입 가능(교사가 비활성 처리로 대응) |

**채택: C안.** 팀 공지로 코드를 공유하고, 가입 즉시 active=TRUE로 사용 시작. 잘못 가입한 계정은 교사가 시트에서 `active=FALSE` 처리. 코드는 Script Property `REGISTER_CODE`로 관리(기본값 `praise2026`, 시트/속성에서 변경 가능).

## 3. 계약 변경 (docs/specs 반영 예정)

### 신규 액션 `register`
- 파라미터: `name`(필수), `part`(선택), `code`(필수)
- 서버 동작: idToken 검증 → `REGISTER_CODE` 대조(trim 비교, 불일치 → `bad_code`) → 이메일 중복 검사(대소문자 무시)
  - 미등록 → MEMBERS에 `[토큰 email, sanitize(name), 'student', sanitize(part), 'TRUE']` append → `{ok, email, name, role:'student', part}`
  - 이미 등록(active) → `already_registered`
  - 이미 등록(inactive) → `deactivated` (재가입으로 활성화 불가 — 교사만 복구 가능)
- **불변식**: role/active는 서버가 강제(`student`/`TRUE`). 클라이언트가 보낸 role·email 무시. LockService 잠금(중복 가입 레이스 방지). name 필수·공백 불가·최대 30자, part 최대 20자.

### `whoami` 변경
- 미등재 시: `{ok:false, code:'unauthorized', email, canRegister:true}` — `canRegister`는 `REGISTER_CODE` 속성이 설정된 경우 true. 프론트는 이 플래그로 가입 화면 표시.

### Setup.gs
- `SETUP_REGISTER_CODE` 상수(기본 `praise2026`) → setupAll 시 `REGISTER_CODE` 속성 설정(이미 있으면 유지 — 운영 중 변경한 코드를 덮어쓰지 않음).

### MEMBERS 시트
- 스키마 변경 없음. (등록 경로만 추가)

## 4. 프론트엔드 변경 (web/index.html)

- `UnauthorizedScreen` → 분기: `canRegister`면 **RegisterScreen**(가입 화면), 아니면 기존 안내 유지.
- RegisterScreen (출석부 디자인 시스템 그대로): 로그인된 email 표시, 이름 입력(필수), 파트 선택(싱어/악기/엔지니어/기타 — 자유입력 겸용), 등록 코드 입력, "등록하기" 버튼 → `register` 호출 → 성공 시 whoami 재조회 후 앱 진입. 에러별 안내: `bad_code`(코드 확인), `already_registered`(새로고침 유도), `deactivated`(교사 문의).
- 로그인 표지 하단 문구 갱신: "찬양팀 전용 · 등록된 계정만" → "찬양팀 전용 · 팀 등록 코드로 가입" 톤.

## 5. 테스트/검증

- V2(test-gas-actions.mjs) 추가 케이스: 정상 가입(행 생성·role=student·active=TRUE 강제 검증), 코드 불일치 → bad_code, 중복 가입 → already_registered, 비활성 재가입 → deactivated, name 누락 → bad_request, name에 수식 인젝션 → escape, 가입 직후 whoami/setRecord 정상 동작
- 하네스/mock-server: `REGISTER_CODE` 속성 시드 추가, /api register 지원(실코드 경로)
- 브라우저 E2E(mock): `MOCK:'newstudent@example.com'` → 가입 화면 → 잘못된 코드 거부 → 올바른 코드 가입 → 오늘 기록 저장까지
- 실사이트 E2E: GAS 재배포 + 프론트 push 후, 실제 코드로 가입 화면 확인(가입 완료는 사용자 계정 필요 시 사용자에게 1클릭 요청)

## 6. 실행 계획 (병렬)

```
계획(본 문서) → 시니어 검토(opus, 기존 에이전트 재사용) → 계약 문서(specs) 확정(총괄)
  ↓ 병렬:
  A. GAS register + Setup.gs + 하네스/테스트     (sonnet)
  B. 프론트 RegisterScreen + 표지 문구            (opus — 디자인 일관성)
  C. 문서 갱신 docs/ops/02·05·06 + CLAUDE.md 반영 (sonnet)
  ↓ 합류: V1~V3 + mock E2E → code-reviewer → (오류 시 시니어 triage) → 수정
  ↓ 배포(크롬 자동화): GAS 파일 갱신(monaco) → setupAll 재실행 → 웹앱 재배포(새 버전) → git push
  ↓ 실사이트 확인 → verifier → 완료 보고
```

## 7. 리스크

1. **코드 유출**: 외부인 가입 가능 → 교사 비활성 처리 + 코드 교체(Script Properties)로 대응. 문서화.
2. **GAS 재배포 누락**: 프론트만 배포되면 register가 unknown_action → 배포 순서를 GAS 먼저로 고정.
3. **기존 사용자 영향**: whoami 응답에 필드 추가만 — 하위호환. setRecord 등 기존 계약 불변.
