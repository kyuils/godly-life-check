// scripts/mock-server.mjs — local E2E dev server (Node stdlib only).
// - Serves E:\...\경건생활점검\web statically (frontend).
// - POST /api delegates to the real GAS logic via scripts/gas-harness.mjs.
// - GET /__mock/records exposes the current RECORDS sheet as JSON, for
//   verifying that writes actually landed with the correct schema.
//
// Usage: node scripts/mock-server.mjs [port]   (default port 8787)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHarness } from './gas-harness.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, '..', 'web');
const PORT = Number(process.argv[2]) || 8787;

// ---- Seed data --------------------------------------------------------------

const MEMBERS = [
  { email: 'student1@example.com', '이름': '홍길동', role: 'student', '파트': '싱어', active: 'TRUE' },
  { email: 'student2@example.com', '이름': '김믿음', role: 'student', '파트': '악기', active: 'TRUE' },
  { email: 'teacher@example.com', '이름': '김교사', role: 'teacher', '파트': '', active: 'TRUE' },
];

// Compute "표준 오늘" through the harness itself (not the host TZ) so the
// seed lines up with whatever setRecord/getAllRecords consider "today".
const probe = createHarness({ members: MEMBERS, records: [] });
const today = probe.todayStr();
const d1 = probe.addDays(today, -1);
const d3 = probe.addDays(today, -3);

function mkRecord(date, email, name, i) {
  const iso = `${date}T09:00:00.000Z`;
  return {
    '날짜': date,
    'email': email,
    '이름': name,
    '말씀읽음': 'TRUE',
    '와닿은말씀': `샘플 와닿은 말씀 ${i}`,
    '결단': `샘플 결단 ${i}`,
    '수련회기도': i % 2 === 0 ? 'TRUE' : 'FALSE',
    '기록시각': iso,
    '수정시각': iso,
  };
}

// 홍길동 최근 5일 중 3일 샘플 기록(오늘/어제/3일전) — 나머지 2일은 공백으로 남겨
// streak·독려 메시지 로직을 프론트에서 눈으로 확인할 수 있게 한다.
// (setRecord 액션은 오늘/어제만 허용하므로, 이 픽스처는 액션 호출이 아니라
//  하네스 시드로 직접 구성한다.)
const RECORDS = [
  mkRecord(today, 'student1@example.com', '홍길동', 1),
  mkRecord(d1, 'student1@example.com', '홍길동', 2),
  mkRecord(d3, 'student1@example.com', '홍길동', 3),
];

const harness = createHarness({ members: MEMBERS, records: RECORDS });

// ---- HTTP server --------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const PLACEHOLDER_INDEX = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>경건생활점검 (mock)</title></head>
<body style="font-family:system-ui;padding:2rem;color:#333">
<h1>경건생활점검 — mock 서버</h1>
<p>web/index.html이 아직 없습니다. 프론트엔드가 추가되면 자동으로 이 페이지 대신 서빙됩니다.</p>
<p>API는 <code>POST /api</code> 로 동작 중입니다. 예: <code>{"action":"whoami","idToken":"mock:teacher@example.com"}</code></p>
</body></html>`;

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, obj) {
  setCors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(WEB_DIR, rel));
  if (!filePath.startsWith(path.normalize(WEB_DIR))) {
    setCors(res);
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    setCors(res);
    if (err) {
      if (rel === '/index.html') {
        // Frontend not built yet — serve an in-memory placeholder so local
        // smoke tests (`GET /` → 200) work regardless of frontend progress.
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PLACEHOLDER_INDEX);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + rel);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  let u;
  try {
    u = new URL(req.url, `http://localhost:${PORT}`);
  } catch (e) {
    res.writeHead(400); res.end('bad request'); return;
  }
  const pathname = u.pathname;

  if (req.method === 'OPTIONS') {
    setCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/api' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch (e) {
        sendJson(res, 200, { ok: false, code: 'bad_request', message: 'invalid JSON body' });
        return;
      }
      try {
        const result = harness.callAction(parsed);
        sendJson(res, 200, result);
      } catch (e) {
        sendJson(res, 200, { ok: false, code: 'server_error', message: String((e && e.message) || e) });
      }
    });
    return;
  }

  if (pathname === '/__mock/records' && req.method === 'GET') {
    const data = harness.sheets.RECORDS.data;
    sendJson(res, 200, { headers: data[0] || [], rows: data.slice(1) });
    return;
  }

  if (req.method === 'GET') {
    serveStatic(req, res, pathname);
    return;
  }

  setCors(res);
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('method not allowed');
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log(' 경건생활점검 mock server');
  console.log('====================================================');
  console.log(` listening: http://localhost:${PORT}`);
  console.log(` static root: ${WEB_DIR}`);
  console.log(' routes:');
  console.log('   GET  /                 → web/index.html (또는 placeholder)');
  console.log('   POST /api              → GAS 액션 라우터 (gas/*.gs 실제 로직)');
  console.log('   GET  /__mock/records   → RECORDS 시트 원시 데이터');
  console.log(' seeded members:');
  console.log('   student1@example.com (홍길동, 싱어)');
  console.log('   student2@example.com (김믿음, 악기)');
  console.log('   teacher@example.com  (김교사, teacher)');
  console.log(` seeded RECORDS: 홍길동 ${today}/${d1}/${d3} (3일)`);
  console.log(' idToken 형식: mock:<email>  (예: mock:teacher@example.com)');
  console.log('====================================================');
});

export { server };
