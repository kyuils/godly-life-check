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
function handleWhoami(body) {
  const auth = authenticate(body);
  if (!auth.ok) return auth;
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
      '말씀읽음': body.wordRead ? 'TRUE' : 'FALSE',
      '와닿은말씀': sanitizeCell_(body.verse || ''),
      '결단': sanitizeCell_(body.resolution || ''),
      '수련회기도': body.retreatPrayer ? 'TRUE' : 'FALSE',
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
    .filter((r) => String(r.role || 'student').trim() === 'student' && isActive_(r.active))
    .map((r) => ({
      email: String(r.email || '').toLowerCase().trim(),
      name: String(r['이름'] || ''),
      role: String(r.role || 'student'),
      part: String(r['파트'] || ''),
    }));
  return { ok: true, members };
}
