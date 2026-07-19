// Actions.gs — the 5 action handlers defined by docs/specs/2026-07-18-api-contract.md §4.

const RECORDS_HEADERS = ['날짜', 'email', '이름', '말씀읽음', '와닿은말씀', '결단', '수련회기도', '기록시각', '수정시각'];

// getAllRecords caches the *unfiltered* RECORDS table under one key so that a
// single invalidation (on setRecord) covers every `days` window a caller
// might request (contract §4/R3 — 5-minute cache, invalidated on write).
const ALL_RECORDS_CACHE_KEY = 'RECORDS_ALL_v1';

function invalidateAllRecordsCache_() {
  try {
    CacheService.getScriptCache().remove(ALL_RECORDS_CACHE_KEY);
  } catch (e) { /* ignore */ }
}

function boolFromCell_(v) {
  if (v === true) return true;
  if (v === false || v === undefined || v === null || v === '') return false;
  return String(v).trim().toUpperCase() === 'TRUE';
}

function rowToMyRecord_(r) {
  return {
    date: formatDate_(r['날짜']),
    wordRead: boolFromCell_(r['말씀읽음']),
    verse: String(r['와닿은말씀'] || ''),
    resolution: String(r['결단'] || ''),
    retreatPrayer: boolFromCell_(r['수련회기도']),
    updatedAt: String(r['수정시각'] || ''),
  };
}

function rowToAllRecord_(r) {
  return {
    date: formatDate_(r['날짜']),
    email: String(r.email || '').toLowerCase().trim(),
    name: String(r['이름'] || ''),
    wordRead: boolFromCell_(r['말씀읽음']),
    verse: String(r['와닿은말씀'] || ''),
    resolution: String(r['결단'] || ''),
    retreatPrayer: boolFromCell_(r['수련회기도']),
    updatedAt: String(r['수정시각'] || ''),
  };
}

// whoami — MEMBERS 등재 + active 이어야 통과 (authenticate가 이미 처리).
// 미등재(unauthorized) 경로에만 canRegister를 부착한다(contract §7 — 다른
// 에러 코드에는 부착하지 않는다. additive/하위호환).
function handleWhoami(body) {
  const auth = authenticate(body);
  if (!auth.ok) {
    if (auth.code === 'unauthorized') {
      return { ok: false, code: 'unauthorized', email: auth.email, canRegister: canRegister_() };
    }
    return auth;
  }
  return { ok: true, email: auth.email, name: auth.name, role: auth.role, part: auth.part };
}

// getMyRecords — 본인 전체 행 (연 단위 파라미터 없음, R2).
function handleGetMyRecords(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;
  const rows = readTable_(SHEET_NAMES.RECORDS).rows
    .filter((r) => String(r.email || '').toLowerCase().trim() === auth.email)
    .map(rowToMyRecord_)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ok: true, rows };
}

// setRecord — (날짜,email) upsert. date는 표준 오늘 또는 어제만 허용(C2/O1).
// email·이름은 토큰 email + MEMBERS 이름만 사용 — 클라이언트가 보낸 값은 무시(C3).
function handleSetRecord(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;

  const date = body && body.date;
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, code: 'bad_request', message: 'date required (yyyy-MM-dd)' };
  }
  const today = todayStr_();
  const yesterday = addDaysToDateStr_(today, -1);
  if (date !== today && date !== yesterday) {
    return { ok: false, code: 'bad_request', message: 'date must be today or yesterday' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const table = readTable_(SHEET_NAMES.RECORDS);
    const headers = table.headers;
    const existing = table.rows.find((r) =>
      formatDate_(r['날짜']) === date && String(r.email || '').toLowerCase().trim() === auth.email
    );
    const now = nowIso_();
    const rowObj = {
      '날짜': date,
      'email': auth.email,
      '이름': auth.name,
      '말씀읽음': body.wordRead === true ? 'TRUE' : 'FALSE',
      '와닿은말씀': sanitizeCell_(body.verse || ''),
      '결단': sanitizeCell_(body.resolution || ''),
      '수련회기도': body.retreatPrayer === true ? 'TRUE' : 'FALSE',
      '기록시각': existing ? (existing['기록시각'] || now) : now,
      '수정시각': now,
    };

    if (existing) {
      updateRowByIndex_(SHEET_NAMES.RECORDS, existing._rowIndex, rowFromObj_(headers, rowObj));
    } else {
      appendRow_(SHEET_NAMES.RECORDS, rowFromObj_(headers, rowObj));
    }
    invalidateAllRecordsCache_();
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

// getAllRecords — teacher/admin 전용. 표준 오늘 기준 후행 days일(기본 60, 최대 366).
function handleGetAllRecords(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;
  if (!isTeacher_(auth)) return { ok: false, code: 'forbidden' };

  let days = Number(body && body.days);
  if (!days || isNaN(days) || days <= 0) days = 60;
  if (days > 366) days = 366;

  const cache = CacheService.getScriptCache();
  let allRows = safeCacheGet_(cache, ALL_RECORDS_CACHE_KEY);
  if (!allRows) {
    allRows = readTable_(SHEET_NAMES.RECORDS).rows.map(rowToAllRecord_);
    safeCachePut_(cache, ALL_RECORDS_CACHE_KEY, allRows, 300); // 5 min (R3)
  }

  const today = todayStr_();
  const cutoff = addDaysToDateStr_(today, -(days - 1));
  const rows = allRows.filter((r) => r.date >= cutoff && r.date <= today);
  return { ok: true, rows };
}

// getMembers — teacher/admin 전용. 활성 학생만.
function handleGetMembers(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;
  if (!isTeacher_(auth)) return { ok: false, code: 'forbidden' };

  const members = readTable_(SHEET_NAMES.MEMBERS).rows
    .filter((r) => String(r.role || 'student').trim().toLowerCase() === 'student' && isActive_(r.active))
    .map((r) => ({
      email: String(r.email || '').toLowerCase().trim(),
      name: String(r['이름'] || ''),
      role: String(r.role || 'student'),
      part: String(r['파트'] || ''),
    }));
  return { ok: true, members };
}

// ---------------------------------------------------------------------------
// register — 자가 등록 (contract §7). authenticate/lookupMember를 쓰지 않는다:
// 이 액션은 정의상 "아직 MEMBERS에 없는" 사용자를 위한 것이므로, 중복/비활성
// 판단을 위해 MEMBERS를 직접 원시 스캔한다(C-1).
// ---------------------------------------------------------------------------

const REGISTER_FAIL_TTL_SECONDS = 600; // 10분 창 (R-1)
const REGISTER_FAIL_THRESHOLD = 5; // 카운터>5 → 코드 검사 전에 too_many_attempts

function registerFailCacheKey_(email) {
  return 'REG_FAIL_' + email;
}

function getRegisterFailCount_(cache, email) {
  const raw = cache.get(registerFailCacheKey_(email));
  const n = Number(raw);
  return isNaN(n) ? 0 : n;
}

function bumpRegisterFailCount_(cache, email) {
  const n = getRegisterFailCount_(cache, email) + 1;
  cache.put(registerFailCacheKey_(email), String(n), REGISTER_FAIL_TTL_SECONDS);
  return n;
}

// 코드 비교 정규화(R-2): 양쪽 모두 trim + 소문자화 + 내부 공백 전부 제거 후 비교.
// 빈 값끼리는 절대 매칭시키지 않는다 — registerCodeConfigured_()가 그 관문.
function normalizeRegisterCode_(v) {
  return String(v === undefined || v === null ? '' : v).trim().toLowerCase().replace(/\s+/g, '');
}

function registerCodeConfigured_() {
  const raw = PropertiesService.getScriptProperties().getProperty('REGISTER_CODE');
  return !!(raw && String(raw).trim().length > 0);
}

// whoami가 노출하는 값 — REGISTER_CODE가 설정 + trim 후 비어있지 않으면 true.
function canRegister_() {
  return registerCodeConfigured_();
}

// 이름/파트 검증·정리(R-4): trim → (필수면) 빈값 거부 → 제어문자·개행 제거 →
// 코드포인트 길이 제한. required=false면 빈 값은 ''로 허용(선택 필드).
function sanitizeRegisterField_(raw, maxLen, required) {
  const trimmed = String(raw === undefined || raw === null ? '' : raw).trim();
  if (!trimmed) {
    return required ? { ok: false } : { ok: true, value: '' };
  }
  const cleaned = trimmed.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
  if (!cleaned) {
    return required ? { ok: false } : { ok: true, value: '' };
  }
  if (Array.from(cleaned).length > maxLen) return { ok: false };
  return { ok: true, value: cleaned };
}

function handleRegister(body) {
  const v = verifyIdToken(body && body.idToken);
  if (!v.ok) return v;
  const email = v.email;

  const nameResult = sanitizeRegisterField_(body && body.name, 30, true);
  if (!nameResult.ok) {
    return { ok: false, code: 'bad_request', message: 'name required (<=30 code points, no control chars)' };
  }
  const partResult = sanitizeRegisterField_(body && body.part, 20, false);
  if (!partResult.ok) {
    return { ok: false, code: 'bad_request', message: 'part too long (<=20 code points)' };
  }

  const cache = CacheService.getScriptCache();
  if (getRegisterFailCount_(cache, email) > REGISTER_FAIL_THRESHOLD) {
    return { ok: false, code: 'too_many_attempts' };
  }

  if (!registerCodeConfigured_()) {
    return { ok: false, code: 'registration_closed' };
  }
  const registerCode = PropertiesService.getScriptProperties().getProperty('REGISTER_CODE');
  if (normalizeRegisterCode_(body && body.code) !== normalizeRegisterCode_(registerCode)) {
    bumpRegisterFailCount_(cache, email);
    return { ok: false, code: 'bad_code' };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // 스캔→append 전체가 잠금 안에서 일어나야 동시 가입 레이스로 인한
    // 중복 행 생성을 막을 수 있다(C-1).
    const table = readTable_(SHEET_NAMES.MEMBERS);
    const headers = table.headers;
    const existing = table.rows.find((r) => String(r.email || '').toLowerCase().trim() === email);
    if (existing) {
      return { ok: false, code: isActive_(existing.active) ? 'already_registered' : 'deactivated' };
    }

    // 서버 강제 불변식: role/active/email은 클라이언트 입력을 절대 반영하지
    // 않는다 — 토큰 email(소문자)·'student'·'TRUE'만 사용한다.
    const rowObj = {
      'email': email,
      '이름': sanitizeCell_(nameResult.value),
      'role': 'student',
      '파트': sanitizeCell_(partResult.value),
      'active': 'TRUE',
    };
    appendRow_(SHEET_NAMES.MEMBERS, rowFromObj_(headers, rowObj));
    return { ok: true, email: email, name: nameResult.value, role: 'student', part: partResult.value };
  } finally {
    lock.releaseLock();
  }
}
