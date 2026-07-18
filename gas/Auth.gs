// Auth.gs — verifies Google ID Token via tokeninfo endpoint, then maps the
// verified email to a MEMBERS row. Pattern carried over from kyuils/youth_group
// Auth.gs (읽기 전용 참고 저장소): tokeninfo verification + token-digest cache.

function verifyIdToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    return { ok: false, code: 'no_token' };
  }
  const props = PropertiesService.getScriptProperties();
  const expectedAud = props.getProperty('OAUTH_CLIENT_ID');
  if (!expectedAud) {
    return { ok: false, code: 'server_misconfig', message: 'OAUTH_CLIENT_ID missing' };
  }

  // Cache successful verifications by token digest for 5 minutes. The
  // tokeninfo round-trip costs 200-500ms on EVERY action; the same Google ID
  // token is reused for ~1h client-side, so this removes that hop from most
  // requests. Only a SHA-256 hash is used as the key — the raw token never
  // enters CacheService. exp is re-checked on every hit so a token cannot
  // outlive its expiry via the cache.
  const tokCache = CacheService.getScriptCache();
  let tokKey = null;
  try {
    const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken, Utilities.Charset.UTF_8);
    tokKey = 'TOK_v1_' + Utilities.base64EncodeWebSafe(digest);
    const hit = tokCache.get(tokKey);
    if (hit) {
      const o = JSON.parse(hit);
      if (Number(o.exp) > Math.floor(Date.now() / 1000)) {
        return { ok: true, email: o.email };
      }
      tokCache.remove(tokKey);
    }
  } catch (e) { /* cache failure must never block auth */ }

  let info;
  try {
    const res = UrlFetchApp.fetch(
      'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
      { muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) {
      return { ok: false, code: 'invalid_token' };
    }
    info = JSON.parse(res.getContentText());
  } catch (e) {
    return { ok: false, code: 'tokeninfo_failed', message: String(e) };
  }

  if (info.aud !== expectedAud) return { ok: false, code: 'aud_mismatch' };
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') {
    return { ok: false, code: 'iss_mismatch' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (Number(info.exp) <= now) return { ok: false, code: 'token_expired' };
  if (!info.email || info.email_verified !== 'true') {
    return { ok: false, code: 'email_unverified' };
  }

  const result = { ok: true, email: String(info.email).toLowerCase().trim() };
  if (tokKey) {
    try {
      tokCache.put(tokKey, JSON.stringify({ email: result.email, exp: Number(info.exp) }), 300);
    } catch (e) { /* ignore */ }
  }
  return result;
}

// lookupMember(email) → { email, name, role, part } | null
// null means "not registered" or "registered but inactive" — both collapse
// to the unauthorized error code in authenticate(), per contract §2.
function lookupMember(email) {
  const rows = readTable_(SHEET_NAMES.MEMBERS).rows;
  const lower = String(email).toLowerCase().trim();
  const found = rows.find((r) => String(r.email || '').toLowerCase().trim() === lower && isActive_(r.active));
  if (!found) return null;
  return {
    email: lower,
    name: String(found['이름'] || ''),
    // MEMBERS is hand-edited; tolerate stray whitespace/casing ('Teacher ').
    role: String(found.role || 'student').trim().toLowerCase(),
    part: String(found['파트'] || ''),
  };
}

// authenticate(body) → { ok, email, name, role, part } | { ok:false, code }
function authenticate(body) {
  const v = verifyIdToken(body && body.idToken);
  if (!v.ok) return v;
  const m = lookupMember(v.email);
  if (!m) return { ok: false, code: 'unauthorized', email: v.email };
  return { ok: true, email: m.email, name: m.name, role: m.role, part: m.part };
}

// v1: admin은 teacher와 동일 취급 (contract §2).
function isTeacher_(auth) {
  return auth.role === 'teacher' || auth.role === 'admin';
}
