# 경건생활점검 (Godly Life Check)

## 목적
혜림교회 청소년부 **찬양팀** 구성원이 매일 자신의 경건생활을 기록·점검하는 웹앱.
학생 본인과 담당 교사만 기록을 볼 수 있다. 데이터는 Google Sheets에 저장한다.

### 핵심 기능 (요구사항 — 변경 금지)
1. 오늘 날주(맥체인 성경일기 본문) 말씀을 **읽었는지 체크**
2. **와닿은 말씀** 구절 기록 (텍스트)
3. 그 말씀으로 오늘을 어떻게 지낼지 **결단** 기록 (텍스트)
4. **수련회를 위한 기도** 여부 체크
5. 자신의 경건생활 현황을 **한눈에 보는 대시보드** (연속 기록, 주간/월간 달성률)
6. 기록을 안 하면 **독려 메시지** 표시
7. 교사(관리자)는 담당 학생들의 기록을 조회 가능

### 아키텍처 (참고: kyuils/youth_group 출석부와 동일)
- `web/index.html` — 정적 단일 파일 프론트엔드 (GitHub Pages 배포)
- `gas/*.gs` — Google Apps Script 웹앱 백엔드 (Sheets 읽기/쓰기 API)
- Google Sheets — 데이터 저장소
- 디자인은 출석부(youth_group)와 동일한 디자인 시스템을 사용한다.

## 명령어
- 검증(전체): `node scripts/check-web.mjs && node scripts/test-gas-actions.mjs && node scripts/test-stats-utils.mjs && node scripts/test-mccheyne.mjs`
- 프론트 정적 검사: `node scripts/check-web.mjs`
- GAS 로직 단위 테스트(모의 SpreadsheetApp): `node scripts/test-gas-actions.mjs`
- 지표/독려 메시지 단위 테스트: `node scripts/test-stats-utils.mjs`
- 맥체인 데이터 검증: `node scripts/test-mccheyne.mjs`
- 로컬 미리보기: `node scripts/mock-server.mjs 8787` 실행 후 브라우저에서 http://localhost:8787
  (로그인까지 보려면 `web/index.html`의 `APP_CONFIG`를 임시로 `GAS_URL:'/api', MOCK:'student1@example.com'`으로 바꾼다.
  교사 화면은 `MOCK:'teacher@example.com'`. **커밋 전 반드시 placeholder로 복원**)

## 규칙 (에이전트·서브에이전트 공통 — 반드시 준수)
- **작업 범위**: 이 저장소(`E:\00_WORKSPACE\경건생활점검`) 밖의 파일을 수정하지 않는다.
  참고 저장소(scratchpad의 youth_group)는 **읽기 전용**이다.
- **요구사항 고정**: 위 "핵심 기능" 목록에 없는 기능을 임의로 추가/삭제하지 않는다.
  변경이 필요하면 총괄 에이전트에게 보고만 한다.
- **API 계약 고정**: `docs/specs/`의 스키마·액션 계약을 임의로 바꾸지 않는다.
  프론트와 백엔드는 이 계약 문서를 단일 기준으로 삼는다.
- **완료 기준**: 검증 명령이 통과하고, 요구사항 목록과 대조 확인한 뒤에만 완료를 선언한다.
- 이 앱에는 진짜 비밀값이 없다: OAuth Client ID·GAS URL은 프론트에 공개되는 값이고, 시트 ID는
  알아도 접근 권한이 없으면 열람 불가(공개 저장소 커밋 허용 — 2026-07-19 결정, Setup.gs에 내장).
  단, 토큰·비밀키·`.env`류는 여전히 커밋 금지.
