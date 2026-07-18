# Apps Script 배포

## 사전 준비
- [01-setup-google-cloud.md](01-setup-google-cloud.md) 완료 — `OAUTH_CLIENT_ID` 확보
- [02-setup-sheet.md](02-setup-sheet.md) 완료 — `SHEET_ID` 확보, MEMBERS/RECORDS 탭 생성

## 1) Apps Script 프로젝트 만들기

시트 → 확장 프로그램 → Apps Script.

이렇게 만든 프로젝트는 시트에 바인딩되어 자동으로 `SpreadsheetApp.getActiveSpreadsheet()`로 이 시트를 가리킨다.

### 코드 넣는 방법 — 둘 중 하나

**방법 A: 직접 붙여넣기 (clasp 없이)**
1. Apps Script IDE 좌측 파일 목록에서 기본 `Code.gs`를 이 저장소의 `gas/Code.gs` 내용으로 덮어쓴다.
2. `+` → 스크립트 파일 추가로 `Auth.gs`, `Sheet.gs`, `Actions.gs`를 각각 만들고 이 저장소 `gas/` 폴더의 동일 이름 파일 내용을 그대로 붙여넣는다.
3. 프로젝트 설정(⚙) → "appsscript.json 매니페스트 파일을 편집기에서 보기" 체크 → `appsscript.json` 탭이 보이면 이 저장소 `gas/appsscript.json` 내용으로 교체한다(runtimeVersion, webapp 설정 등).

**방법 B: clasp 사용 (1회 설치)**
```powershell
npm install -g @google/clasp
clasp login
```
Apps Script IDE URL에서 `scriptId`를 메모한 뒤, 로컬 `gas/` 폴더에서:
```powershell
clasp clone <scriptId>
clasp push
```
이후 코드를 수정할 때마다 `clasp push`로 반영한다.

## 2) Script Properties 등록

Apps Script IDE → 프로젝트 설정(⚙) → "스크립트 속성" → "스크립트 속성 추가":

| 속성 | 값 |
|---|---|
| `SHEET_ID` | `02-setup-sheet.md`에서 메모한 시트 ID |
| `OAUTH_CLIENT_ID` | `01-setup-google-cloud.md`에서 발급한 Client ID |

두 값 모두 빠지면 서버가 `server_misconfig` 에러를 반환한다(`06-operations.md` 문제 해결 참고).

## 3) 배포

IDE 우상단 "배포" → "새 배포":
- 유형 선택(⚙ 아이콘) → **웹 앱**
- 설명: `v1.0.0` (버전 관리용, 이후 수정 시 `v1.0.1`처럼 올려서 새 배포)
- **실행 계정: 나** (= 배포자 권한으로 실행. 이 설정 덕분에 학생·교사에게 시트 공유가 필요 없다 — `02-setup-sheet.md` 참고)
- **액세스 권한: 모든 사용자** (로그인 여부와 무관하게 URL에 접근 가능해야 함. 인증은 이 앱이 자체적으로 idToken 검증으로 처리한다)

배포 후 나오는 웹앱 URL을 메모한다. 형식: `https://script.google.com/macros/s/AKfycb.../exec`

## 4) 코드 수정 시 재배포 관례

Apps Script는 **코드를 저장해도 이미 배포된 `/exec` URL에는 자동 반영되지 않는다.** 코드를 고칠 때마다:
1. IDE에서 저장 (또는 `clasp push`)
2. "배포" → "배포 관리" → 기존 배포 옆 연필 아이콘 → "새 버전" 선택 → 배포

이렇게 해야 같은 `/exec` URL이 최신 코드로 갱신된다. "새 배포"를 매번 새로 만들면 URL이 바뀌어 프론트(`web/index.html`)의 `APP_CONFIG.GAS_URL`도 매번 바꿔야 하므로, 기존 배포를 "새 버전"으로 갱신하는 방식을 권장한다.

## 5) 통합 테스트 — curl

### 토큰 없이 whoami 호출
```powershell
curl -X POST "<GAS_URL>" -H "Content-Type: text/plain" -d "{\"action\":\"whoami\"}"
```
기대: `{"ok":false,"code":"no_token"}`

### 존재하지 않는 액션
```powershell
curl -X POST "<GAS_URL>" -H "Content-Type: text/plain" -d "{\"action\":\"banana\"}"
```
기대: `{"ok":false,"code":"unknown_action"}`

### Script Properties 누락 확인 (선택)
`SHEET_ID`나 `OAUTH_CLIENT_ID` 중 하나를 지우고 위 whoami 요청을 다시 보내면 `{"ok":false,"code":"server_misconfig"}`가 나오는지 확인 후, 값을 다시 채워 넣는다.

토큰이 필요한 나머지 액션(`getMyRecords`, `setRecord`, `getAllRecords`, `getMembers`)은 실제 구글 로그인 토큰이 있어야 하므로, 프론트엔드 배포(`04-deploy-github-pages.md`) 후 브라우저에서 검증한다(`05-test-checklist.md`).
