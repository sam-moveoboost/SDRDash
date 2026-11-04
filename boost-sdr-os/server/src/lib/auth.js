// Works out who is asking, from monday's signed session token. This is the lock:
// nothing the browser sends (a user ID in the URL, a flag) is trusted on its own.

const jwt = require('jsonwebtoken');
const { getSecret } = require('./secrets');
const { ADMIN_USER_IDS } = require('./config');

function requireViewer(req, res, next) {
  const secret = getSecret('MONDAY_CLIENT_SECRET');
  if (!secret) {
    return res.status(503).json({ error: 'not_configured', message: 'The server is missing MONDAY_CLIENT_SECRET.' });
  }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    const userId = String(payload?.dat?.user_id ?? '');
    if (!userId) throw new Error('no user in token');
    req.viewer = { userId, isAdmin: ADMIN_USER_IDS.includes(userId) };
    return next();
  } catch (_err) {
    return res.status(401).json({ error: 'not_signed_in', message: 'Could not verify your monday login.' });
  }
}

// Which SDR's data this request may see.
//  - SDRs: always their own. Asking for anyone else is refused.
//  - Admins: a named SDR, or the whole team when no one is named or "all".
// Returns { sdrId } where sdrId is a string user ID or null for the whole team, or { denied: true }.
function resolveScope(viewer, requested) {
  const asked = requested ? String(requested) : null;
  if (!viewer.isAdmin) {
    if (asked && asked !== 'me' && asked !== viewer.userId) return { denied: true };
    return { sdrId: viewer.userId };
  }
  if (!asked || asked === 'all') return { sdrId: null };
  if (asked === 'me') return { sdrId: viewer.userId };
  return { sdrId: asked };
}

module.exports = { requireViewer, resolveScope };
