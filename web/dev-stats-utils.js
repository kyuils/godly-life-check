/* web/dev-stats-utils.js
 * 경건생활 점검 — 순수 지표 함수. 계약(docs/specs/2026-07-18-api-contract.md) §3 엄수.
 * 브라우저(window.DevStatsUtils) + Node(require) 겸용 IIFE.
 *
 * rows = getMyRecords 응답 형태: [{ date:'YYYY-MM-DD', wordRead:bool, verse, resolution, retreatPrayer:bool, updatedAt }]
 * todayStr = 표준 오늘(Asia/Seoul 'YYYY-MM-DD').
 *
 * 핵심 정의(§3):
 *  - "기록한 날" = 해당 날짜 행의 말씀읽음(wordRead) === true. (텍스트·수련회기도만 있는 날은 미포함)
 *  - streak = 오늘부터 거슬러 wordRead=true 연속 일수. 오늘 미기록이면 어제부터(오늘은 끊지 않음).
 *  - 주간 달성률 = 이번 주(월~일, KST) 경과 일수 중 기록한 날 비율.
 *  - 월간 달성률 = 이번 달 경과 일수 중 기록한 날 비율.
 *  - 수련회 기도 = 별도 카운터: 최근 n일(기본 7) 중 retreatPrayer=true 인 날 수.
 */
(function (root) {
  'use strict';

  // ── 날짜 유틸: 모든 날짜는 KST 'YYYY-MM-DD' 문자열. UTC 기준 정수 연산으로 DST 영향 배제 ──
  function isoDate(iso) {
    return typeof iso === 'string' ? iso.slice(0, 10) : '';
  }
  function addDays(iso, n) {
    var d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) {
    // b - a (일수)
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
  }
  // 0=월 .. 6=일 (월~일 주간 기준)
  function dowMon0(iso) {
    var dow = new Date(iso + 'T00:00:00Z').getUTCDay(); // 0=일..6=토
    return dow === 0 ? 6 : dow - 1;
  }

  function toArray(v) {
    return Array.isArray(v) ? v : [];
  }

  // wordRead === true 인 날짜 Set
  function recordedSet(rows) {
    var set = {};
    toArray(rows).forEach(function (r) {
      if (r && r.wordRead === true) {
        var d = isoDate(r.date);
        if (d) set[d] = true;
      }
    });
    return set;
  }

  function pct(done, total) {
    return total > 0 ? Math.round((done / total) * 100) : 0;
  }

  // ── streak ──────────────────────────────────────────────
  function computeStreak(rows, todayStr) {
    var rec = recordedSet(rows);
    var cursor = todayStr;
    // 오늘 미기록이면 어제부터 센다(오늘은 아직 기회가 있으므로 끊지 않음, §3)
    if (!rec[cursor]) cursor = addDays(cursor, -1);
    var streak = 0;
    // 안전 상한(설치형 앱 수명 이내)
    for (var i = 0; i < 4000 && rec[cursor]; i++) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  // ── 주간 달성률 (이번 주 월~일, 경과일=월요일~오늘 포함) ──
  function weeklyRate(rows, todayStr) {
    var rec = recordedSet(rows);
    var monday = addDays(todayStr, -dowMon0(todayStr));
    var total = daysBetween(monday, todayStr) + 1; // 경과 일수(오늘 포함)
    var done = 0;
    var d = monday;
    for (var i = 0; i < total; i++) {
      if (rec[d]) done++;
      d = addDays(d, 1);
    }
    return { done: done, total: total, pct: pct(done, total) };
  }

  // ── 월간 달성률 (이번 달 1일~오늘 포함) ──
  function monthlyRate(rows, todayStr) {
    var rec = recordedSet(rows);
    var first = isoDate(todayStr).slice(0, 8) + '01';
    var total = Number(isoDate(todayStr).slice(8, 10)); // 경과 일수 = 오늘의 '일'
    var done = 0;
    var d = first;
    for (var i = 0; i < total; i++) {
      if (rec[d]) done++;
      d = addDays(d, 1);
    }
    return { done: done, total: total, pct: pct(done, total) };
  }

  // ── 수련회 기도 카운터: 최근 days일(오늘 포함) 중 retreatPrayer=true 인 날 수 ──
  function retreatPrayerCount(rows, todayStr, days) {
    var n = days || 7;
    var start = addDays(todayStr, -(n - 1));
    var set = {};
    toArray(rows).forEach(function (r) {
      if (!r || r.retreatPrayer !== true) return;
      var d = isoDate(r.date);
      if (d && d >= start && d <= todayStr) set[d] = true;
    });
    return Object.keys(set).length;
  }

  // ── 독려 메시지 (tone 4분기, 날짜 해시로 결정적 선택) ──
  var MESSAGES = {
    praise: [
      '오늘도 말씀 앞에 섰네요. 이 하루가 복이 됩니다.',
      '잘하고 있어요. 오늘의 한 걸음이 내일을 만듭니다.',
      '말씀으로 시작한 오늘, 하나님이 함께하십니다.',
      '기록 완료! 꾸준함이 곧 경건입니다.',
    ],
    nudge: [
      '오늘 말씀은 읽으셨나요? 지금 잠깐이면 충분해요.',
      '하루쯤 쉬어갈 수 있어요. 오늘 다시 시작해봐요.',
      '작은 틈이 생겼네요. 오늘 한 절이면 이어집니다.',
      '괜찮아요, 오늘 다시 펼치면 됩니다.',
    ],
    strong: [
      '며칠 멈춰 있었네요. 오늘 다시 말씀 앞으로 나아가요.',
      '다시 시작하기 가장 좋은 날은 오늘입니다.',
      '멀어진 만큼 다시 가까이. 지금 한 절부터 시작해요.',
      '하나님은 여전히 당신을 기다리십니다. 오늘 돌이켜요.',
    ],
    milestone: [
      '연속 기록 달성! 놀라운 꾸준함이에요.',
      '이 여정이 열매를 맺고 있어요. 축하합니다!',
      '한 고비를 넘었어요. 하나님이 기뻐하십니다.',
      '멋진 이정표에 도달했어요. 계속 나아가요!',
    ],
  };

  function hashStr(s) {
    var h = 0;
    var str = String(s);
    for (var i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  function encourageMessage(rows, todayStr) {
    var rec = recordedSet(rows);
    var streak = computeStreak(rows, todayStr);
    var todayDone = !!rec[todayStr];

    var tone;
    if (todayDone && (streak === 7 || streak === 14 || streak === 30)) {
      // milestone 우선(단, 오늘 기록으로 이정표에 '도달'한 경우) — 계약 §5
      tone = 'milestone';
    } else if (todayDone) {
      tone = 'praise';
    } else {
      // 오늘 미기록: 마지막 기록일까지의 공백(오늘 포함 결측 일수)
      var cursor = addDays(todayStr, -1);
      var gap = 1; // 오늘 하나가 이미 결측
      var found = false;
      for (var i = 0; i < 400; i++) {
        if (rec[cursor]) { found = true; break; }
        gap++;
        cursor = addDays(cursor, -1);
      }
      if (!found) gap = Infinity; // 기록이 전혀 없음 → strong
      tone = gap <= 2 ? 'nudge' : 'strong';
    }

    var pool = MESSAGES[tone];
    var text = pool[hashStr(todayStr) % pool.length];
    return { tone: tone, text: text };
  }

  var api = {
    computeStreak: computeStreak,
    weeklyRate: weeklyRate,
    monthlyRate: monthlyRate,
    retreatPrayerCount: retreatPrayerCount,
    encourageMessage: encourageMessage,
    // 내부 유틸(테스트/뷰 재사용)
    _addDays: addDays,
    _daysBetween: daysBetween,
    _dowMon0: dowMon0,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DevStatsUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
