// Sheet.gs — sheet I/O helpers for 경건생활점검 (MEMBERS / RECORDS).
// Pattern carried over from kyuils/youth_group (읽기 전용 참고 저장소), simplified
// to this app's domain — no class/newcomer specific helpers.

const SHEET_NAMES = {
  MEMBERS: 'MEMBERS',
  RECORDS: 'RECORDS',
};

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('SHEET_ID Script Property not set');
  return SpreadsheetApp.openById(id);
}

function getSheet_(name) {
  const sh = getSpreadsheet_().getSheetByName(name);
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}

// Header-name based table reader (contract §2, R1). Never relies on column
// order/position. Returns { headers, rows }; each row is an object keyed by
// header text, plus _rowIndex (1-based sheet row number, header row = 1).
function readTable_(name) {
  const sh = getSheet_(name);
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return { headers: [], rows: [] };
  const last = sh.getLastRow();
  if (last < 2) {
    return { headers: sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String), rows: [] };
  }
  const values = sh.getRange(1, 1, last, lastCol).getValues();
  const headers = values[0].map(String);
  const rows = values.slice(1).map((row, i) => {
    const obj = { _rowIndex: i + 2 };
    headers.forEach((h, j) => { obj[h] = row[j]; });
    return obj;
  });
  return { headers, rows };
}

function appendRow_(name, headerOrderedValues) {
  getSheet_(name).appendRow(headerOrderedValues);
}

function updateRowByIndex_(name, rowIndex, headerOrderedValues) {
  const sh = getSheet_(name);
  sh.getRange(rowIndex, 1, 1, headerOrderedValues.length).setValues([headerOrderedValues]);
}

// Build a value array in header order from a partial object.
function rowFromObj_(headers, obj) {
  return headers.map((h) => (obj[h] === undefined ? '' : obj[h]));
}

// active 열 규칙(출석부 isActive_ 그대로): 빈 값은 active, FALSE/NO/0/N만 비활성.
function isActive_(v) {
  if (v === undefined || v === null || v === '') return true;
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v).trim().toUpperCase();
  return s !== 'FALSE' && s !== 'NO' && s !== '0' && s !== 'N';
}

// Realm-agnostic Date check: `instanceof Date` can miss real Date instances
// that were created in a different JS realm (e.g. a Node vm sandbox used by
// the test harness), since each realm has its own Date constructor. The
// [[Class]] tag from Object.prototype.toString is realm-independent and
// behaves identically to `instanceof Date` for genuine Date objects on the
// single-realm Apps Script runtime, so this is safe in production too.
function isDateLike_(v) {
  return v !== null && typeof v === 'object' && Object.prototype.toString.call(v) === '[object Date]';
}

// Defense against Sheets formula injection. Google Sheets evaluates cells
// starting with = + - @ as formulas — prefix such inputs with a single quote
// so they are stored as literal text.
function sanitizeCell_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean' || isDateLike_(v)) return v;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

// Date cell → 'yyyy-MM-dd' (Asia/Seoul). RECORDS always *writes* a string,
// but Sheets may hand back a Date object on read depending on cell/column
// formatting — this normalizes both shapes (contract §1/§2).
function formatDate_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (isDateLike_(v)) {
    return Utilities.formatDate(v, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  return String(v).trim();
}

// Standard "today" — Asia/Seoul YYYY-MM-DD string (contract §1). Single
// source of truth that both McCheyne lookup (frontend) and record targeting
// (backend) derive from.
function todayStr_() {
  return Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd');
}

// Pure calendar-day arithmetic on a 'yyyy-MM-dd' string — no timezone
// dependency (UTC midnight is used purely as a neutral epoch for day math).
// Used for the today/yesterday window check in setRecord and the trailing
// `days` window in getAllRecords.
function addDaysToDateStr_(dateStr, days) {
  const parts = String(dateStr).split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + days);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function nowIso_() {
  return new Date().toISOString();
}

// CacheService.put has a 100KB per-value limit; skip caching rather than throw.
function safeCachePut_(cache, key, value, seconds) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    if (s.length > 95000) return false;
    cache.put(key, s, seconds);
    return true;
  } catch (e) {
    return false;
  }
}

function safeCacheGet_(cache, key) {
  try {
    const raw = cache.get(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}
