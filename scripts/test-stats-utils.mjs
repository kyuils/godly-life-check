// scripts/test-stats-utils.mjs
// dev-stats-utils.js 단위 테스트. 계약 §3 지표 정의 검증. 실패 시 exit 1.
// 사용: node scripts/test-stats-utils.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  computeStreak,
  weeklyRate,
  monthlyRate,
  retreatPrayerCount,
  encourageMessage,
  _addDays,
} = require('../web/dev-stats-utils.js');

// 행 헬퍼
function rec(date, opts = {}) {
  return {
    date,
    wordRead: opts.wordRead !== undefined ? opts.wordRead : true,
    verse: opts.verse || '',
    resolution: opts.resolution || '',
    retreatPrayer: opts.retreatPrayer === true,
    updatedAt: opts.updatedAt || (date + 'T00:00:00Z'),
  };
}

const TODAY = '2026-07-16'; // 목요일 (2026-07-16 == 목)
const D = (n) => _addDays(TODAY, n);

let passed = 0;
function ok(name, fn) {
  fn();
  passed++;
  console.log('  ok -', name);
}

// ─────────── computeStreak ───────────
console.log('computeStreak');

ok('오늘 기록 시 streak에 오늘 포함', () => {
  const rows = [rec(TODAY), rec(D(-1)), rec(D(-2))];
  assert.equal(computeStreak(rows, TODAY), 3);
});

ok('오늘 미기록이면 어제부터 연속 계산(오늘이 끊지 않음)', () => {
  const rows = [rec(D(-1)), rec(D(-2)), rec(D(-3))];
  // 오늘 기록 없음 → 어제부터 3일 연속
  assert.equal(computeStreak(rows, TODAY), 3);
});

ok('오늘도 어제도 없으면 0', () => {
  const rows = [rec(D(-2)), rec(D(-3))];
  assert.equal(computeStreak(rows, TODAY), 0);
});

ok('말씀읽음 FALSE인 날은 끊김', () => {
  const rows = [rec(TODAY), rec(D(-1), { wordRead: false }), rec(D(-2))];
  // 오늘 1일, 어제 FALSE로 끊김
  assert.equal(computeStreak(rows, TODAY), 1);
});

ok('수련회기도만 TRUE인 날은 기록으로 안 침', () => {
  const rows = [
    rec(TODAY),
    rec(D(-1), { wordRead: false, retreatPrayer: true }),
    rec(D(-2)),
  ];
  assert.equal(computeStreak(rows, TODAY), 1);
});

// ─────────── weeklyRate ───────────
console.log('weeklyRate');

ok('주 중간(목요일) 경과일 기준 계산 (월~오늘 포함)', () => {
  // TODAY=목 → 이번주 월~목 = 4일 경과
  // 월,수 기록 → done=2, total=4, pct=50
  const monday = _addDays(TODAY, -3); // 월
  const wednesday = _addDays(TODAY, -1); // 수
  const rows = [rec(monday), rec(wednesday)];
  assert.deepEqual(weeklyRate(rows, TODAY), { done: 2, total: 4, pct: 50 });
});

ok('지난 주 기록은 이번 주 달성률에 포함되지 않음', () => {
  const lastWeek = _addDays(TODAY, -7);
  const rows = [rec(lastWeek), rec(TODAY)];
  // 이번 주 total=4(월~목), done=1(오늘)
  assert.deepEqual(weeklyRate(rows, TODAY), { done: 1, total: 4, pct: 25 });
});

// ─────────── monthlyRate ───────────
console.log('monthlyRate');

ok('월간 경과일=오늘의 일(7/16 → 16일), 기록수 비율', () => {
  const rows = [rec('2026-07-01'), rec('2026-07-10'), rec(TODAY)];
  // total=16, done=3
  assert.deepEqual(monthlyRate(rows, TODAY), { done: 3, total: 16, pct: 19 });
});

ok('다른 달 기록은 이번 달 집계에서 제외', () => {
  const rows = [rec('2026-06-30'), rec('2026-07-05')];
  assert.deepEqual(monthlyRate(rows, TODAY), { done: 1, total: 16, pct: 6 });
});

// ─────────── retreatPrayerCount ───────────
console.log('retreatPrayerCount');

ok('최근 7일 창 내 retreatPrayer=true 일수', () => {
  const rows = [
    rec(TODAY, { retreatPrayer: true }),
    rec(D(-3), { retreatPrayer: true }),
    rec(D(-6), { retreatPrayer: true }),
    rec(D(-7), { retreatPrayer: true }), // 창 밖(7일 전) → 제외
    rec(D(-2), { retreatPrayer: false }),
  ];
  assert.equal(retreatPrayerCount(rows, TODAY, 7), 3);
});

ok('기본 창(7일) 동작', () => {
  const rows = [rec(TODAY, { retreatPrayer: true }), rec(D(-1), { retreatPrayer: true })];
  assert.equal(retreatPrayerCount(rows, TODAY), 2);
});

// ─────────── encourageMessage ───────────
console.log('encourageMessage');

ok('praise — 오늘 기록 완료(이정표 아님)', () => {
  const rows = [rec(TODAY), rec(D(-1)), rec(D(-2))]; // streak 3
  const m = encourageMessage(rows, TODAY);
  assert.equal(m.tone, 'praise');
  assert.ok(typeof m.text === 'string' && m.text.length > 0);
});

ok('nudge — 오늘 미기록, 공백 ≤ 2일', () => {
  const rows = [rec(D(-1)), rec(D(-2))]; // 어제 기록 → 공백 1일
  assert.equal(encourageMessage(rows, TODAY).tone, 'nudge');
});

ok('strong — 3일 이상 공백', () => {
  const rows = [rec(D(-4)), rec(D(-5))]; // 마지막 기록 4일 전 → 공백 4일
  assert.equal(encourageMessage(rows, TODAY).tone, 'strong');
});

ok('milestone — 오늘 기록으로 7일 연속 도달(우선)', () => {
  const rows = [];
  for (let i = 0; i < 7; i++) rows.push(rec(D(-i))); // 오늘 포함 7일 연속
  assert.equal(computeStreak(rows, TODAY), 7);
  assert.equal(encourageMessage(rows, TODAY).tone, 'milestone');
});

ok('결정적 — 같은 입력이면 같은 메시지', () => {
  const rows = [rec(TODAY), rec(D(-1))];
  const a = encourageMessage(rows, TODAY);
  const b = encourageMessage(rows, TODAY);
  assert.equal(a.text, b.text);
  assert.equal(a.tone, b.tone);
});

console.log(`\nALL PASS (${passed} cases)`);
