// Code.gs — entry point and action router.

// Resolved at call time (not file-evaluation time) so the handler functions in
// Actions.gs need not be evaluated before this file — GAS evaluates .gs files
// in editor order, which deployers must not have to care about.
function getHandler_(action) {
  const ACTIONS = {
    whoami: handleWhoami,
    getMyRecords: handleGetMyRecords,
    setRecord: handleSetRecord,
    getAllRecords: handleGetAllRecords,
    getMembers: handleGetMembers,
  };
  return ACTIONS[action] || null;
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action;
    const handler = action ? getHandler_(action) : null;
    if (!handler) {
      return jsonOut({ ok: false, code: 'unknown_action', action });
    }
    const result = handler(body);
    return jsonOut(result);
  } catch (err) {
    // Log full detail server-side for diagnosis, but return only a generic
    // code to clients — the internal message may contain sheet IDs, file
    // paths, or stack trace fragments useful to an attacker.
    console.error('[server_error]', err && err.stack ? err.stack : err);
    return jsonOut({ ok: false, code: 'server_error' });
  }
}

// Build tag — bump whenever code is materially changed. Lets us check
// whether the deployment captured the latest snapshot by hitting GET /exec.
const BUILD_TAG = 'v1.0.0-godly-life-check';

function doGet(e) {
  // Health check only. The HTML is hosted on GitHub Pages.
  return jsonOut({ ok: true, service: 'godly-life-check', build: BUILD_TAG });
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
