// scripts/test-gas-actions.mjs — unit tests for gas/*.gs action handlers,
// run through scripts/gas-harness.mjs (mock SpreadsheetApp etc.).
// Exits 1 if any case fails.

import { createHarness } from './gas-harness.mjs';

let passed = 0;
let failed = 0;

function report(name, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  PASS - ${name}`);
  } else {
    failed++;
    console.log(`  FAIL - ${name}`);
    if (detail !== undefined) console.log(`         ${detail}`);
  }
}

function eq(name, actual, expected) {
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  report(name, pass, pass ? undefined : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

function truthy(name, actual) {
  report(name, !!actual, `actual=${JSON.stringify(actual)}`);
}

function section(title) {
  console.log(`\n[${title}]`);
}

const BASE_MEMBERS = [
  { email: 'student1@example.com', '이름': '홍길동', role: 'student', '파트': '싱어', active: 'TRUE' },
  { email: 'student2@example.com', '이름': '김믿음', role: 'student', '파트': '악기', active: 'TRUE' },
  { email: 'teacher@example.com', '이름': '김교사', role: 'teacher', '파트': '', active: 'TRUE' },
  { email: 'inactive@example.com', '이름': '비활성학생', role: 'student', '파트': '', active: 'FALSE' },
];

function mkRecord(date, email, name, opts = {}) {
  const iso = opts.recordedAt || `${date}T09:00:00.000Z`;
  return {
    '날짜': date,
    'email': email,
    '이름': name,
    '말씀읽음': opts.wordRead === false ? 'FALSE' : 'TRUE',
    '와닿은말씀': opts.verse || '',
    '결단': opts.resolution || '',
    '수련회기도': opts.retreatPrayer ? 'TRUE' : 'FALSE',
    '기록시각': iso,
    '수정시각': opts.updatedAt || iso,
  };
}

// ============================================================
// 1. whoami
// ============================================================
section('1. whoami');
{
  const h = createHarness({ members: BASE_MEMBERS, records: [] });

  const res1 = h.callAction({ action: 'whoami', idToken: 'mock:student1@example.com' });
  eq('등재 학생 → ok', res1.ok, true);
  eq('등재 학생 → name', res1.name, '홍길동');
  eq('등재 학생 → role', res1.role, 'student');

  const res2 = h.callAction({ action: 'whoami', idToken: 'mock:nobody@example.com' });
  eq('미등재 email → unauthorized', res2, { ok: false, code: 'unauthorized', email: 'nobody@example.com', canRegister: true });

  const res3 = h.callAction({ action: 'whoami', idToken: 'not-a-mock-token' });
  eq('잘못된 토큰 → invalid_token', res3.ok, false);
  truthy('잘못된 토큰 → code는 invalid_token 계열', res3.code === 'invalid_token');

  const res4 = h.callAction({ action: 'whoami' });
  eq('토큰 없음 → no_token', res4, { ok: false, code: 'no_token' });

  const res5 = h.callAction({ action: 'whoami', idToken: 'mock:inactive@example.com' });
  eq('비활성 학생 → unauthorized (보너스)', res5, { ok: false, code: 'unauthorized', email: 'inactive@example.com', canRegister: true });
}

// ============================================================
// 2. setRecord
// ============================================================
section('2. setRecord');
{
  const h = createHarness({ members: BASE_MEMBERS, records: [] });
  const today = h.todayStr();
  const yesterday = h.addDays(today, -1);
  const tomorrow = h.addDays(today, 1);
  const threeDaysAgo = h.addDays(today, -3);

  // 오늘 신규 → 행 생성
  const r1 = h.callAction({
    action: 'setRecord', idToken: 'mock:student1@example.com',
    date: today, wordRead: true, verse: '시 23:1', resolution: '오늘 결단',
    retreatPrayer: false,
    // 클라이언트가 email/name을 보내도 서버는 토큰 email + MEMBERS 이름만 써야 한다.
    email: 'attacker@example.com', name: '해커',
  });
  eq('오늘 신규 setRecord → ok', r1, { ok: true });

  const dataAfterCreate = h.sheets.RECORDS.data;
  eq('오늘 신규 → 데이터 행 1개 생성', dataAfterCreate.length - 1, 1);
  const headers = dataAfterCreate[0];
  const row1 = dataAfterCreate[1];
  const idx = (h_) => headers.indexOf(h_);
  eq('신규 행 email = 토큰 email (클라 값 무시)', row1[idx('email')], 'student1@example.com');
  eq('신규 행 이름 = MEMBERS 이름 (클라 값 무시)', row1[idx('이름')], '홍길동');
  eq('신규 행 말씀읽음 = TRUE 문자열', row1[idx('말씀읽음')], 'TRUE');
  eq('신규 행 수련회기도 = FALSE 문자열', row1[idx('수련회기도')], 'FALSE');
  eq('신규 행 날짜', row1[idx('날짜')], today);

  // 같은 날 재호출 → upsert (행 수 불변 + 내용 갱신)
  const r2 = h.callAction({
    action: 'setRecord', idToken: 'mock:student1@example.com',
    date: today, wordRead: false, verse: '갱신된 말씀', resolution: '갱신된 결단',
    retreatPrayer: true,
  });
  eq('같은 날 재호출 → ok', r2, { ok: true });
  const dataAfterUpsert = h.sheets.RECORDS.data;
  eq('같은 날 재호출 → 행 수 불변', dataAfterUpsert.length - 1, 1);
  const row1b = dataAfterUpsert[1];
  eq('upsert 후 말씀읽음 갱신', row1b[idx('말씀읽음')], 'FALSE');
  eq('upsert 후 수련회기도 갱신', row1b[idx('수련회기도')], 'TRUE');
  eq('upsert 후 와닿은말씀 갱신', row1b[idx('와닿은말씀')], '갱신된 말씀');

  // 어제 → ok (새 행 추가, 날짜가 다르므로 upsert 대상 아님)
  const r3 = h.callAction({
    action: 'setRecord', idToken: 'mock:student1@example.com',
    date: yesterday, wordRead: true, verse: '', resolution: '', retreatPrayer: false,
  });
  eq('어제 날짜 → ok', r3, { ok: true });
  eq('어제 날짜 → 행 2개(오늘+어제)', h.sheets.RECORDS.data.length - 1, 2);

  // 미래 날짜 → bad_request
  const r4 = h.callAction({
    action: 'setRecord', idToken: 'mock:student1@example.com',
    date: tomorrow, wordRead: true, verse: '', resolution: '', retreatPrayer: false,
  });
  eq('미래 날짜 → bad_request', r4.ok, false);
  eq('미래 날짜 → code', r4.code, 'bad_request');

  // 3일 전 → bad_request
  const r5 = h.callAction({
    action: 'setRecord', idToken: 'mock:student1@example.com',
    date: threeDaysAgo, wordRead: true, verse: '', resolution: '', retreatPrayer: false,
  });
  eq('3일 전 → bad_request', r5.ok, false);
  eq('3일 전 → code', r5.code, 'bad_request');

  // verse에 수식 인젝션 시도 → 시트에 이스케이프되어 기록
  const r6 = h.callAction({
    action: 'setRecord', idToken: 'mock:student2@example.com',
    date: today, wordRead: true, verse: '=SUM(A1)', resolution: '-DANGEROUS', retreatPrayer: false,
  });
  eq('injection 시도 → ok', r6, { ok: true });
  const injRow = h.sheets.RECORDS.data.find((row, i) => i > 0 && row[idx('email')] === 'student2@example.com');
  truthy('injection verse → 시트에 escape되어 저장', injRow && injRow[idx('와닿은말씀')] === "'=SUM(A1)");
  truthy('injection resolution → 시트에 escape되어 저장', injRow && injRow[idx('결단')] === "'-DANGEROUS");
}

// ============================================================
// 3. getMyRecords
// ============================================================
section('3. getMyRecords');
{
  const probe = createHarness({ members: BASE_MEMBERS, records: [] });
  const today = probe.todayStr();
  // 날짜 셀이 Date 객체인 시드 — Utilities.formatDate(Asia/Seoul)로 정규화되는지 확인.
  // UTC 03:00 = KST 12:00 이므로 호스트 TZ와 무관하게 안정적으로 today로 해석된다.
  const [y, m, d] = today.split('-').map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d, 3, 0, 0));

  const records = [
    mkRecord(today, 'student2@example.com', '김믿음', { wordRead: false, retreatPrayer: true }),
    { ...mkRecord(today, 'student1@example.com', '홍길동', { wordRead: true, verse: '시23', resolution: '결단1' }), '날짜': dateObj },
  ];
  const h = createHarness({ members: BASE_MEMBERS, records });

  const res = h.callAction({ action: 'getMyRecords', idToken: 'mock:student1@example.com' });
  eq('getMyRecords → ok', res.ok, true);
  eq('본인 행만 반환 (1개)', res.rows.length, 1);
  const row = res.rows[0];
  eq('Date 객체 날짜 → yyyy-MM-dd 문자열', row.date, today);
  report('wordRead가 boolean', typeof row.wordRead === 'boolean' && row.wordRead === true);
  eq('verse 반환', row.verse, '시23');
  eq('resolution 반환', row.resolution, '결단1');
  report('retreatPrayer가 boolean', typeof row.retreatPrayer === 'boolean' && row.retreatPrayer === false);

  const emails = res.rows.map((r) => r.email);
  report('타인(student2) 행 미포함', emails.indexOf('student2@example.com') === -1 && !('email' in row));
}

// ============================================================
// 4. getAllRecords
// ============================================================
section('4. getAllRecords');
{
  const probe = createHarness({ members: BASE_MEMBERS, records: [] });
  const today = probe.todayStr();
  const d1 = probe.addDays(today, -1);
  const d10 = probe.addDays(today, -10);
  const d100 = probe.addDays(today, -100);

  const records = [
    mkRecord(today, 'student1@example.com', '홍길동'),
    mkRecord(d1, 'student2@example.com', '김믿음'),
    mkRecord(d10, 'student1@example.com', '홍길동'),
    mkRecord(d100, 'student2@example.com', '김믿음'),
  ];
  const h = createHarness({ members: BASE_MEMBERS, records });

  const forbiddenRes = h.callAction({ action: 'getAllRecords', idToken: 'mock:student1@example.com' });
  eq('student → forbidden', forbiddenRes, { ok: false, code: 'forbidden' });

  const defaultRes = h.callAction({ action: 'getAllRecords', idToken: 'mock:teacher@example.com' });
  eq('teacher → ok', defaultRes.ok, true);
  eq('teacher 기본(60일) → today/d1/d10 포함, d100 제외 → 3건', defaultRes.rows.length, 3);
  const defaultDates = defaultRes.rows.map((r) => r.date).sort();
  eq('기본 윈도우 날짜 집합', defaultDates, [d10, d1, today].sort());

  const windowedRes = h.callAction({ action: 'getAllRecords', idToken: 'mock:teacher@example.com', days: 5 });
  eq('days=5 윈도우 → today/d1만 (2건)', windowedRes.rows.length, 2);
  const windowedDates = windowedRes.rows.map((r) => r.date).sort();
  eq('days=5 윈도우 날짜 집합', windowedDates, [d1, today].sort());
}

// ============================================================
// 5. getMembers
// ============================================================
section('5. getMembers');
{
  const h = createHarness({ members: BASE_MEMBERS, records: [] });

  const forbiddenRes = h.callAction({ action: 'getMembers', idToken: 'mock:student1@example.com' });
  eq('student → forbidden', forbiddenRes, { ok: false, code: 'forbidden' });

  const teacherRes = h.callAction({ action: 'getMembers', idToken: 'mock:teacher@example.com' });
  eq('teacher → ok', teacherRes.ok, true);
  eq('활성 학생만 (2명, 비활성·teacher 제외)', teacherRes.members.length, 2);
  const memberEmails = teacherRes.members.map((m) => m.email).sort();
  eq('활성 학생 이메일 집합', memberEmails, ['student1@example.com', 'student2@example.com']);
  const memberRoles = teacherRes.members.map((m) => m.role);
  report('teacher/비활성 학생 미포함', memberRoles.every((r) => r === 'student'));
}

// ============================================================
// 6. 리뷰 반영 회귀 테스트 (파일 평가 순서, role 정규화, 엄격 bool)
// ============================================================
section('6. 리뷰 반영 회귀');
{
  // GAS는 편집기 파일 순서로 평가한다 — Code.gs가 첫 번째여도 동작해야 한다.
  const worstOrder = createHarness({
    members: BASE_MEMBERS,
    records: [],
    fileOrder: ['Code.gs', 'Actions.gs', 'Auth.gs', 'Sheet.gs'],
  });
  const orderRes = worstOrder.callAction({ action: 'whoami', idToken: 'mock:student1@example.com' });
  eq('Code.gs 최우선 평가 순서에서도 whoami ok', orderRes.ok, true);

  // MEMBERS는 수기 입력 — role의 공백/대소문자 편차를 허용해야 한다.
  const messyMembers = [
    { email: 'student1@example.com', '이름': '홍길동', role: ' STUDENT', '파트': '싱어', active: 'TRUE' },
    { email: 'teacher@example.com', '이름': '김교사', role: 'Teacher ', '파트': '', active: 'TRUE' },
  ];
  const messy = createHarness({ members: messyMembers, records: [] });
  const messyTeacher = messy.callAction({ action: 'getMembers', idToken: 'mock:teacher@example.com' });
  eq("role 'Teacher ' → 교사 권한 인정 (getMembers ok)", messyTeacher.ok, true);
  eq("role ' STUDENT' → 학생 명단에 포함", messyTeacher.members.map((m) => m.email), ['student1@example.com']);
  const messyWho = messy.callAction({ action: 'whoami', idToken: 'mock:teacher@example.com' });
  eq('whoami role이 정규화되어 반환', messyWho.role, 'teacher');

  // 계약은 bool — 문자열 "false"는 truthy지만 TRUE로 저장되면 안 된다.
  const strict = createHarness({ members: BASE_MEMBERS, records: [] });
  const strictToday = strict.todayStr();
  const strictRes = strict.callAction({
    action: 'setRecord', idToken: 'mock:student1@example.com',
    date: strictToday, wordRead: 'false', verse: '', resolution: '', retreatPrayer: 'false',
  });
  eq('문자열 "false" setRecord → ok', strictRes.ok, true);
  const strictData = strict.sheets.RECORDS.data;
  const col = (name) => strictData[0].indexOf(name);
  const strictRow = strictData.find((row, i) => i > 0 && row[col('날짜')] === strictToday);
  eq('문자열 "false" wordRead → FALSE 저장', strictRow[col('말씀읽음')], 'FALSE');
  eq('문자열 "false" retreatPrayer → FALSE 저장', strictRow[col('수련회기도')], 'FALSE');
}

// ============================================================
// 7. register
// ============================================================
section('7. register');
{
  // ---- 정상 가입 ----
  {
    const h = createHarness({ members: BASE_MEMBERS, records: [] });
    const res = h.callAction({
      action: 'register', idToken: 'mock:newbie@example.com',
      name: '새신자', part: '보컬', code: 'praise2026',
      // 클라이언트가 role/active/email을 조작해도 서버는 무시해야 한다.
      role: 'admin', active: 'FALSE', email: 'spoof@example.com',
    });
    eq('정상 가입 → ok', res, { ok: true, email: 'newbie@example.com', name: '새신자', role: 'student', part: '보컬' });

    const data = h.sheets.MEMBERS.data;
    const headers = data[0];
    const idx = (hh) => headers.indexOf(hh);
    const row = data.find((r, i) => i > 0 && r[idx('email')] === 'newbie@example.com');
    truthy('가입 행 존재', !!row);
    eq('가입 행 email 소문자', row[idx('email')], 'newbie@example.com');
    eq('가입 행 role = student (클라 admin 무시)', row[idx('role')], 'student');
    eq('가입 행 active = TRUE (클라 FALSE 무시)', row[idx('active')], 'TRUE');
    eq('가입 행 이름', row[idx('이름')], '새신자');
    eq('가입 행 파트', row[idx('파트')], '보컬');

    // ---- 가입 직후 whoami/setRecord 엔드투엔드 ----
    const who = h.callAction({ action: 'whoami', idToken: 'mock:newbie@example.com' });
    eq('가입 직후 whoami → ok', who, { ok: true, email: 'newbie@example.com', name: '새신자', role: 'student', part: '보컬' });

    const today = h.todayStr();
    const setRes = h.callAction({
      action: 'setRecord', idToken: 'mock:newbie@example.com',
      date: today, wordRead: true, verse: '', resolution: '', retreatPrayer: false,
    });
    eq('가입 직후 setRecord → ok', setRes, { ok: true });
  }

  // ---- 코드 불일치 / 정규화 ----
  {
    const h = createHarness({ members: BASE_MEMBERS, records: [] });
    const bad = h.callAction({ action: 'register', idToken: 'mock:codetest1@example.com', name: '홍', code: 'wrong-code' });
    eq('코드 불일치 → bad_code', bad, { ok: false, code: 'bad_code' });

    const normalized = h.callAction({ action: 'register', idToken: 'mock:codetest2@example.com', name: '김', code: 'Praise 2026' });
    eq("코드 'Praise 2026'(대문자+공백) → 정규화로 ok", normalized.ok, true);
    eq('정규화 가입 role', normalized.role, 'student');
  }

  // ---- 중복 검사 ----
  {
    const h = createHarness({ members: BASE_MEMBERS, records: [] });
    const before = h.sheets.MEMBERS.data.length;

    const dup = h.callAction({ action: 'register', idToken: 'mock:student1@example.com', name: '홍길동', code: 'praise2026' });
    eq('활성 중복 → already_registered', dup, { ok: false, code: 'already_registered' });
    eq('활성 중복 → 행 수 불변', h.sheets.MEMBERS.data.length, before);

    const deact = h.callAction({ action: 'register', idToken: 'mock:inactive@example.com', name: '비활성학생', code: 'praise2026' });
    eq('비활성 재가입 → deactivated', deact, { ok: false, code: 'deactivated' });
    eq('비활성 재가입 → 행 수 불변(밴 우회 append 없음)', h.sheets.MEMBERS.data.length, before);
  }

  // ---- REGISTER_CODE 미설정 ----
  {
    const h = createHarness({ members: BASE_MEMBERS, records: [], registerCode: null });
    const res = h.callAction({ action: 'register', idToken: 'mock:closed@example.com', name: '닫힘', code: 'anything' });
    eq('REGISTER_CODE 미설정 → registration_closed', res, { ok: false, code: 'registration_closed' });

    const who = h.callAction({ action: 'whoami', idToken: 'mock:nobody-closed@example.com' });
    eq('REGISTER_CODE 미설정 → whoami canRegister false', who,
      { ok: false, code: 'unauthorized', email: 'nobody-closed@example.com', canRegister: false });
  }

  // ---- 설정된 하네스: 미등재 whoami canRegister true ----
  {
    const h = createHarness({ members: BASE_MEMBERS, records: [] }); // 기본 registerCode = 'praise2026'
    const who = h.callAction({ action: 'whoami', idToken: 'mock:stranger@example.com' });
    eq('설정된 하네스 → 미등재 whoami canRegister true', who,
      { ok: false, code: 'unauthorized', email: 'stranger@example.com', canRegister: true });
  }

  // ---- 이름 검증 ----
  {
    const h = createHarness({ members: BASE_MEMBERS, records: [] });

    const missing = h.callAction({ action: 'register', idToken: 'mock:noname@example.com', code: 'praise2026' });
    eq('name 누락 → bad_request', missing.ok, false);
    eq('name 누락 → code', missing.code, 'bad_request');

    const tooLong = h.callAction({ action: 'register', idToken: 'mock:toolong@example.com', name: 'a'.repeat(31), code: 'praise2026' });
    eq('name 31자 → bad_request', tooLong.code, 'bad_request');

    const withNewline = h.callAction({ action: 'register', idToken: 'mock:newline@example.com', name: '홍\n길동', code: 'praise2026' });
    eq('name 개행 포함 → ok(정리 후 저장)', withNewline.ok, true);
    const nlHeaders = h.sheets.MEMBERS.data[0];
    const nlRow = h.sheets.MEMBERS.data.find((r, i) => i > 0 && r[nlHeaders.indexOf('email')] === 'newline@example.com');
    eq('개행이 제거되어 저장', nlRow[nlHeaders.indexOf('이름')], '홍길동');

    const injection = h.callAction({ action: 'register', idToken: 'mock:injector@example.com', name: '=SUM(A1)', code: 'praise2026' });
    eq('수식 인젝션 이름 → ok', injection.ok, true);
    eq('수식 인젝션 이름 → 응답값은 escape 안 됨', injection.name, '=SUM(A1)');
    const injHeaders = h.sheets.MEMBERS.data[0];
    const injRow = h.sheets.MEMBERS.data.find((r, i) => i > 0 && r[injHeaders.indexOf('email')] === 'injector@example.com');
    eq('수식 인젝션 이름 → 시트에 escape되어 저장', injRow[injHeaders.indexOf('이름')], "'=SUM(A1)");
  }

  // ---- 백오프 ----
  {
    const h = createHarness({ members: BASE_MEMBERS, records: [] });
    for (let i = 0; i < 6; i++) {
      const attempt = h.callAction({ action: 'register', idToken: 'mock:backoff@example.com', name: '테스트', code: 'wrong' });
      eq(`bad_code 시도 ${i + 1} → bad_code`, attempt.code, 'bad_code');
    }
    const blocked = h.callAction({ action: 'register', idToken: 'mock:backoff@example.com', name: '테스트', code: 'praise2026' });
    eq('bad_code 6회 이후 → too_many_attempts (정답 코드라도 차단)', blocked, { ok: false, code: 'too_many_attempts' });
  }
}

// ============================================================
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
