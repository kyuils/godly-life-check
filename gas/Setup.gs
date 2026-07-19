// Setup.gs — one-time initialization helper. Not used at runtime.
//
// 사용법 (docs/ops/03-deploy-gas.md 참고):
//   1) 아래 SETUP_OAUTH_CLIENT_ID에 OAuth 클라이언트 ID를 붙여넣는다 (01 문서에서 발급).
//      아직 없으면 그대로 두고 나중에 다시 실행해도 된다.
//   2) GAS 편집기에서 함수 선택 → setupAll → 실행. 최초 실행 시 권한 승인 창이 뜬다.
//   3) 실행 로그에 "SETUP COMPLETE"가 나오면 끝. 여러 번 실행해도 안전하다(멱등).

// 경건생활점검 DB 스프레드시트 (kyuils@gmail.com 드라이브에 생성됨, 2026-07-19)
const SETUP_SHEET_ID = '1SEsp65ufwjrxg-xv8dpUfO39tpDnSUmH0nXvwu7PsxI';
const SETUP_OAUTH_CLIENT_ID = '90527666620-ududtg9blamqqp06v7i21uo4loijqs12.apps.googleusercontent.com';

// 최초 관리자 계정 — MEMBERS 탭이 새로 만들어질 때 이 계정을 admin으로 등록한다.
const SETUP_ADMIN_EMAIL = 'kyuils@gmail.com';
const SETUP_ADMIN_NAME = '관리자';

// 자가 등록 팀 코드 (contract §7). 이 저장소는 공개이므로 실제 코드를 여기 두지
// 않는다 — 코드 자체가 접근 통제 게이트이기 때문. GAS 편집기에서만 실제 값을
// 붙여넣고 setupAll()을 실행하거나, Script Properties에서 REGISTER_CODE를 직접
// 관리한다. placeholder 상태로 실행하면 등록은 폐쇄(registration_closed)로 남는다.
const SETUP_REGISTER_CODE = 'PASTE_REGISTER_CODE_HERE';

function setupAll() {
  setupProperties_();
  setupTabs_();
  Logger.log('SETUP COMPLETE — MEMBERS/RECORDS 탭과 Script Properties가 준비되었습니다.');
}

function setupProperties_() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', SETUP_SHEET_ID);
  if (SETUP_OAUTH_CLIENT_ID && SETUP_OAUTH_CLIENT_ID !== 'PASTE_CLIENT_ID_HERE') {
    props.setProperty('OAUTH_CLIENT_ID', SETUP_OAUTH_CLIENT_ID);
    Logger.log('Script Properties: SHEET_ID, OAUTH_CLIENT_ID 설정 완료');
  } else {
    Logger.log('Script Properties: SHEET_ID 설정 완료. OAUTH_CLIENT_ID는 아직 placeholder — ' +
      '01 문서에서 클라이언트 ID 발급 후 SETUP_OAUTH_CLIENT_ID에 붙여넣고 setupAll을 다시 실행하세요.');
  }

  // REGISTER_CODE는 미설정(trim 후 빈 값 — registerCodeConfigured_와 동일 기준)일
  // 때만 넣는다 — 운영 중 변경한 값을 보존한다. placeholder 상수는 넣지 않는다.
  const existingCode = props.getProperty('REGISTER_CODE');
  const constUsable = SETUP_REGISTER_CODE &&
    SETUP_REGISTER_CODE !== 'PASTE_REGISTER_CODE_HERE' &&
    String(SETUP_REGISTER_CODE).trim().length > 0;
  if (existingCode && String(existingCode).trim().length > 0) {
    Logger.log('Script Properties: REGISTER_CODE 기존 값 유지(운영 중 변경값 보존)');
  } else if (constUsable) {
    props.setProperty('REGISTER_CODE', String(SETUP_REGISTER_CODE).trim());
    Logger.log('Script Properties: REGISTER_CODE 설정 완료');
  } else {
    Logger.log('Script Properties: REGISTER_CODE 미설정 — 등록은 폐쇄 상태(registration_closed). ' +
      'SETUP_REGISTER_CODE에 실제 코드를 붙여넣고 재실행하거나 스크립트 속성에서 직접 설정하세요.');
  }
}

const SETUP_MEMBERS_HEADERS = ['email', '이름', 'role', '파트', 'active'];
const SETUP_RECORDS_HEADERS = ['날짜', 'email', '이름', '말씀읽음', '와닿은말씀', '결단', '수련회기도', '기록시각', '수정시각'];

function setupTabs_() {
  const ss = SpreadsheetApp.openById(SETUP_SHEET_ID);

  const membersCreated = ensureTab_(ss, 'MEMBERS', SETUP_MEMBERS_HEADERS);
  ensureTab_(ss, 'RECORDS', SETUP_RECORDS_HEADERS);

  // role 열 드롭다운 (입력 오류 방지 — 서버는 공백/대소문자를 허용하지만 오타는 못 막는다)
  const members = ss.getSheetByName('MEMBERS');
  const roleRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['student', 'teacher', 'admin'], true)
    .setAllowInvalid(true)
    .build();
  members.getRange(2, 3, 200, 1).setDataValidation(roleRule);

  // 새로 만든 경우에만 최초 관리자 등록
  if (membersCreated) {
    members.appendRow([SETUP_ADMIN_EMAIL, SETUP_ADMIN_NAME, 'admin', '', 'TRUE']);
    Logger.log('MEMBERS: 최초 관리자 등록 — ' + SETUP_ADMIN_EMAIL);
  }

  // 기본 빈 시트 제거 (Sheet1/시트1)
  ['Sheet1', '시트1'].forEach(function (name) {
    const s = ss.getSheetByName(name);
    if (s && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
}

// 탭이 없으면 만들고 헤더를 기록. 반환값: 새로 만들었는지 여부.
function ensureTab_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  const created = !sheet;
  if (!sheet) sheet = ss.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const headerOk = headers.every(function (h, i) { return String(current[i]) === h; });
  if (!headerOk) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return created;
}
