# 따라하기 — Apps Script 초기 설정 (setupAll 실행)

> 시트가 빈 페이지인 것이 정상입니다. 탭과 헤더는 `setupAll()`이 실행될 때 자동으로 만들어집니다.
> 소요 시간: 약 5분

## 1단계. 시트에서 Apps Script 편집기 열기

1. 경건생활점검 DB 시트를 엽니다:
   https://docs.google.com/spreadsheets/d/1SEsp65ufwjrxg-xv8dpUfO39tpDnSUmH0nXvwu7PsxI/edit
2. 상단 메뉴에서 **확장 프로그램 → Apps Script**를 클릭합니다.
3. "제목 없는 프로젝트"라는 이름의 편집기가 새 탭으로 열립니다.
   (이름은 좌측 상단을 클릭해 `경건생활점검`으로 바꿔두면 좋습니다)

## 2단계. 코드 파일 5개 붙여넣기

코드 원본은 컴퓨터의 **`E:\00_WORKSPACE\경건생활점검\gas\`** 폴더에 있습니다.
메모장이나 VS Code로 열어서 내용 전체를 복사하면 됩니다.

1. 편집기에 기본으로 있는 `Code.gs`를 클릭 → 안의 내용(`function myFunction()...`)을
   **전부 지우고** → `gas\Code.gs` 파일 내용을 붙여넣습니다.
2. 좌측 "파일" 옆 **+ → 스크립트**를 눌러 새 파일을 만들고 이름을 `Auth`로 입력합니다
   (확장자 .gs는 자동으로 붙습니다) → `gas\Auth.gs` 내용을 붙여넣습니다.
3. 같은 방법으로 `Sheet`, `Actions`, `Setup` 파일을 만들어 각각
   `gas\Sheet.gs`, `gas\Actions.gs`, `gas\Setup.gs` 내용을 붙여넣습니다.
4. **Ctrl+S**로 전부 저장합니다. (파일 순서는 상관없습니다)

참고: `Setup.gs`에는 시트 ID가 이미 박혀 있으니 아무것도 수정할 필요 없습니다.

## 3단계. setupAll 실행 (여기서 탭이 만들어집니다)

1. 편집기 상단 툴바의 **함수 선택 드롭다운**(디버그 버튼 옆)에서 **`setupAll`**을 선택합니다.
2. **실행** 버튼을 누릅니다.
3. 처음 실행하면 **"승인 필요"** 창이 뜹니다 — 이렇게 진행하세요:
   - "권한 검토" 클릭 → 본인 계정(kyuils@gmail.com) 선택
   - **"확인되지 않은 앱"** 경고 화면이 나올 수 있습니다. 본인이 방금 만든 스크립트라서
     뜨는 표준 경고이니 겁먹지 않으셔도 됩니다.
     → 왼쪽 아래 **"고급"** 클릭 → **"...(안전하지 않음)으로 이동"** 클릭 → **허용**
4. 실행이 끝나면 하단 **실행 로그**에 다음이 나오면 성공입니다:
   - `SETUP COMPLETE — MEMBERS/RECORDS 탭과 Script Properties가 준비되었습니다.`
   - `OAUTH_CLIENT_ID는 아직 placeholder...`라는 안내도 함께 나오는데 **지금은 정상**입니다.
     OAuth 클라이언트를 아직 안 만들었기 때문이고, 나중에 채우면 됩니다(5단계).

## 4단계. 결과 확인

시트 탭으로 돌아가 보면:

- 하단에 **MEMBERS**, **RECORDS** 탭 2개가 생겨 있고
- MEMBERS 1행에 굵은 헤더(`email | 이름 | role | 파트 | active`),
  2행에 `kyuils@gmail.com | 관리자 | admin | (빈칸) | TRUE`가 등록되어 있고
- role 열(C열)을 클릭하면 student/teacher/admin **드롭다운**이 뜹니다.

여기까지 되면 이 단계는 끝입니다.
학생·교사 명단은 MEMBERS 탭에 한 줄씩 추가하면 됩니다(각자 구글 로그인에 쓰는 이메일 필수).

## 5단계. 나중에 한 번 더 (OAuth 클라이언트 발급 후)

`01-setup-google-cloud.md` 절차로 Client ID를 발급받으면:

1. `Setup.gs` 상단의 `SETUP_OAUTH_CLIENT_ID = 'PASTE_CLIENT_ID_HERE'` 부분에
   발급받은 ID를 붙여넣고
2. `setupAll`을 **한 번 더 실행** → 로그에 `SHEET_ID, OAUTH_CLIENT_ID 설정 완료`가
   나오면 서버 설정 완료입니다.

## 다음 단계

- 웹앱 배포: `03-deploy-gas.md`의 3번 항목 (배포 후 나오는 **URL(/exec)**을 메모)
- 막히는 화면이 있으면 그 화면에 보이는 문구를 그대로 알려주세요.
