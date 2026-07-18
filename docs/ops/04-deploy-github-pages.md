# GitHub Pages 배포

## 사전 준비
- [03-deploy-gas.md](03-deploy-gas.md) 완료 — GAS 웹앱 `/exec` URL 확보

## 1) GitHub 저장소 생성 및 푸시

이미 로컬에 `E:\00_WORKSPACE\경건생활점검` 저장소가 있다면, 원격 저장소를 만들고 연결한다.

```powershell
git remote add origin https://github.com/<user>/godly-life-check.git
git branch -M main
git push -u origin main
```

## 2) Pages 활성화

저장소 → Settings → Pages:
- Source: `Deploy from a branch`
- Branch: `main` / `/web` 폴더 (프론트가 `web/` 안에 있으므로)

저장 후 1~2분 뒤 URL이 활성화된다:
- 예: `https://<user>.github.io/godly-life-check/web/index.html`

(경로에 `/web/`이 붙는 게 싫으면 `root`로 두고 저장소 최상위에 `index.html`을 두거나, GitHub Actions로 `/web` 폴더만 배포하도록 구성한다.)

## 3) `web/index.html`의 `APP_CONFIG` 채우기

`web/index.html` 상단의 설정 객체를 찾는다:

```js
window.APP_CONFIG = {
  GAS_URL: 'https://script.google.com/macros/s/AKfycb.../exec',
  OAUTH_CLIENT_ID: '1234567890-abc...apps.googleusercontent.com',
  MOCK: false,
};
```

- `GAS_URL`: `03-deploy-gas.md`에서 확보한 `/exec` URL로 교체.
- `OAUTH_CLIENT_ID`: `01-setup-google-cloud.md`에서 발급한 Client ID로 교체.
- `MOCK`: **반드시 `false`**인지 확인한다. `true`로 두면 실제 구글 로그인을 건너뛰고 가짜 사용자로 진입하는 개발 전용 모드라, 실제 배포에서는 절대 켜두면 안 된다(모든 방문자가 검증 없이 앱에 들어오게 됨).

세 값을 채운 뒤 커밋·푸시하면 GitHub Pages가 자동으로 재배포한다.

```powershell
git add web/index.html
git commit -m "Configure production APP_CONFIG"
git push
```

## 4) Google Cloud Console에 도메인 재확인

[01-setup-google-cloud.md](01-setup-google-cloud.md)의 "승인된 JavaScript 원본"에 다음이 등록되어 있는지 확인한다:
- `https://<user>.github.io`

누락되어 있으면 추가하고 저장한다. 이 값이 없으면 로그인 버튼을 눌렀을 때 `redirect_uri_mismatch` 또는 origin 관련 오류가 브라우저 콘솔에 뜬다.

## 5) 첫 확인

- 발급된 Pages URL 접속 → "구글로 로그인" 버튼이 표시되는지 확인.
- MEMBERS 시트에 등록한 이메일로 로그인 → 정상 진입 확인.
- MEMBERS에 없는 이메일로 로그인 → 접근 권한 없음 안내 화면 확인.
- 여기까지 확인되면 `05-test-checklist.md`로 넘어가 전체 시나리오를 점검한다.
