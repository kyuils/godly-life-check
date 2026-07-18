// scripts/gas-harness.mjs — loads gas/*.gs into a Node vm context with mock
// GAS globals (SpreadsheetApp, PropertiesService, LockService, CacheService,
// ContentService, Utilities, UrlFetchApp) so the real backend logic can run
// and be unit-tested outside Apps Script.
//
// Usage:
//   import { createHarness } from './gas-harness.mjs';
//   const h = createHarness({ members: [...], records: [...] });
//   const res = h.callAction({ action: 'whoami', idToken: 'mock:student1@example.com' });

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAS_DIR = path.join(__dirname, '..', 'gas');

// GAS evaluates .gs files in editor order, which deployers can't be expected
// to control — the backend must work under ANY order (top-level code must not
// reference functions from other files at evaluation time). Tests exercise a
// worst-case order via the fileOrder option of createHarness.
const GAS_FILES = ['Sheet.gs', 'Auth.gs', 'Actions.gs', 'Code.gs'];

export const MEMBERS_HEADERS = ['email', '이름', 'role', '파트', 'active'];
export const RECORDS_HEADERS = ['날짜', 'email', '이름', '말씀읽음', '와닿은말씀', '결단', '수련회기도', '기록시각', '수정시각'];

// ---- Mock SpreadsheetApp ---------------------------------------------------

class MockSheet {
  constructor(headers, objRows) {
    const dataRows = objRows.map((o) => headers.map((h) => (o[h] === undefined ? '' : o[h])));
    this.data = [headers.slice(), ...dataRows];
  }
  getLastRow() { return this.data.length; }
  getLastColumn() { return this.data.length ? this.data[0].length : 0; }
  getRange(row, col, numRows, numCols) {
    numRows = numRows || 1;
    numCols = numCols || 1;
    const self = this;
    return {
      getValues() {
        const out = [];
        for (let r = 0; r < numRows; r++) {
          const rr = row - 1 + r;
          const rowArr = [];
          for (let c = 0; c < numCols; c++) {
            const cc = col - 1 + c;
            const v = self.data[rr] ? self.data[rr][cc] : undefined;
            rowArr.push(v === undefined ? '' : v);
          }
          out.push(rowArr);
        }
        return out;
      },
      setValues(values) {
        for (let r = 0; r < values.length; r++) {
          const rr = row - 1 + r;
          while (self.data.length <= rr) self.data.push([]);
          for (let c = 0; c < values[r].length; c++) {
            const cc = col - 1 + c;
            self.data[rr][cc] = values[r][c];
          }
        }
      },
    };
  }
  appendRow(values) {
    this.data.push(values.slice());
  }
}

function createSpreadsheetApp(sheetsByName) {
  return {
    openById(_id) {
      return {
        getSheetByName(name) {
          return sheetsByName[name] || null;
        },
      };
    },
  };
}

// ---- Mock PropertiesService / LockService / CacheService ------------------

function createPropertiesService(props) {
  const scriptProps = {
    getProperty(key) { return Object.prototype.hasOwnProperty.call(props, key) ? props[key] : null; },
  };
  return { getScriptProperties: () => scriptProps };
}

function createLockService() {
  return {
    getScriptLock() {
      return { waitLock() {}, releaseLock() {} };
    },
  };
}

function createCacheService() {
  const store = new Map(); // key -> { value, expiresAt }
  const cache = {
    get(key) {
      const e = store.get(key);
      if (!e) return null;
      if (Date.now() > e.expiresAt) { store.delete(key); return null; }
      return e.value;
    },
    put(key, value, seconds) {
      store.set(key, { value: String(value), expiresAt: Date.now() + (Number(seconds) || 600) * 1000 });
    },
    remove(key) {
      store.delete(key);
    },
  };
  return { getScriptCache: () => cache, _store: store };
}

// ---- Mock ContentService ---------------------------------------------------

function createContentService() {
  return {
    MimeType: { JSON: 'JSON', TEXT: 'TEXT' },
    createTextOutput(text) {
      return {
        _text: text,
        setMimeType() { return this; },
        getContent() { return this._text; },
      };
    },
  };
}

// ---- Mock Utilities ---------------------------------------------------------

function createUtilities() {
  return {
    formatDate(date, tz, pattern) {
      if (pattern !== 'yyyy-MM-dd') {
        throw new Error("Mock Utilities.formatDate only supports the 'yyyy-MM-dd' pattern used by this app, got: " + pattern);
      }
      // en-CA locale formats as YYYY-MM-DD, exactly the pattern we need.
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || 'Asia/Seoul',
        year: 'numeric', month: '2-digit', day: '2-digit',
      });
      return fmt.format(date);
    },
    computeDigest(_algo, value, _charset) {
      const hash = crypto.createHash('sha256').update(String(value), 'utf8').digest();
      return Array.from(hash);
    },
    base64EncodeWebSafe(byteArray) {
      const buf = Buffer.from(byteArray);
      return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
  };
}

// ---- Mock UrlFetchApp (tokeninfo) ------------------------------------------
// `mock:<email>` id tokens are treated as always-valid; anything else is a
// 400 (invalid_token), letting tests exercise the invalid-token path.

function createUrlFetchApp() {
  return {
    fetch(url) {
      let idToken = '';
      try {
        idToken = new URL(url).searchParams.get('id_token') || '';
      } catch (e) { /* ignore malformed url */ }
      if (idToken.indexOf('mock:') === 0) {
        const email = idToken.slice('mock:'.length);
        const nowSec = Math.floor(Date.now() / 1000);
        const body = {
          aud: 'mock-client',
          iss: 'accounts.google.com',
          exp: nowSec + 3600,
          email,
          email_verified: 'true',
        };
        return {
          getResponseCode() { return 200; },
          getContentText() { return JSON.stringify(body); },
        };
      }
      return {
        getResponseCode() { return 400; },
        getContentText() { return JSON.stringify({ error: 'invalid_token' }); },
      };
    },
  };
}

// ---- Harness ----------------------------------------------------------------

export function createHarness(seed = {}) {
  const members = seed.members || [];
  const records = seed.records || [];

  const sheetsByName = {
    MEMBERS: new MockSheet(MEMBERS_HEADERS, members),
    RECORDS: new MockSheet(RECORDS_HEADERS, records),
  };

  const scriptProps = { SHEET_ID: 'mock', OAUTH_CLIENT_ID: 'mock-client' };

  const sandbox = {
    console,
    SpreadsheetApp: createSpreadsheetApp(sheetsByName),
    PropertiesService: createPropertiesService(scriptProps),
    LockService: createLockService(),
    CacheService: createCacheService(),
    ContentService: createContentService(),
    Utilities: createUtilities(),
    UrlFetchApp: createUrlFetchApp(),
  };

  const context = vm.createContext(sandbox);
  const fileOrder = seed.fileOrder || GAS_FILES;
  for (const file of fileOrder) {
    const code = fs.readFileSync(path.join(GAS_DIR, file), 'utf8');
    vm.runInContext(code, context, { filename: file });
  }

  function callAction(body) {
    const e = { postData: { contents: JSON.stringify(body || {}) } };
    const output = context.doPost(e);
    return JSON.parse(output.getContent());
  }

  function callGet() {
    const output = context.doGet({});
    return JSON.parse(output.getContent());
  }

  return {
    callAction,
    callGet,
    sheets: sheetsByName,
    context,
    todayStr() { return context.todayStr_(); },
    addDays(dateStr, days) { return context.addDaysToDateStr_(dateStr, days); },
  };
}
