const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Signed session tokens (HMAC-SHA256, no external dependency).
// A token is:  base64url(JSON payload) + "." + base64url(HMAC)
// Payload: { uid, role, exp }
//
// AUTH_SECRET must be set in the environment for sessions to survive a
// restart/redeploy. If it is missing we generate an ephemeral one so the app
// still runs (users just have to log in again after a restart).
// ---------------------------------------------------------------------------
const SECRET = process.env.AUTH_SECRET || process.env.JWT_SECRET || (() => {
  console.warn('[auth] AUTH_SECRET is not set. Using an ephemeral secret: sessions will be invalidated on restart/redeploy. Set AUTH_SECRET in the environment to keep users logged in.');
  return crypto.randomBytes(32).toString('hex');
})();

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function signToken(payload) {
  const body = Object.assign({}, payload, { exp: Date.now() + TOKEN_TTL_MS });
  const data = base64url(JSON.stringify(body));
  const sig = base64url(crypto.createHmac('sha256', SECRET).update(data).digest());
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = base64url(crypto.createHmac('sha256', SECRET).update(data).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let body;
  try {
    body = JSON.parse(fromBase64url(data).toString('utf8'));
  } catch (err) {
    return null;
  }
  if (!body || typeof body.exp !== 'number' || body.exp < Date.now()) return null;
  if (!body.uid || !body.role) return null;
  return body;
}

function getTokenFromRequest(req) {
  const header = req.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  return req.get('x-auth-token') || null;
}

// Constant-time string comparison for secrets like delivery tokens.
function safeEqual(a, b) {
  if (a == null || b == null) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// Requires a valid token whose role is in allowedRoles.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    const body = verifyToken(getTokenFromRequest(req));
    if (!body) return res.status(401).json({ error: 'Unauthorized' });
    if (allowedRoles.length && !allowedRoles.includes(body.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    req.userId = body.uid;
    req.userRole = body.role;
    next();
  };
}

// Attaches req.userId/req.userRole if a valid token is present, but never
// rejects. Useful for endpoints that allow either an authenticated user or a
// scoped delivery token.
function optionalAuth(req, res, next) {
  const body = verifyToken(getTokenFromRequest(req));
  if (body) {
    req.userId = body.uid;
    req.userRole = body.role;
  }
  next();
}

module.exports = { requireRole, optionalAuth, signToken, verifyToken, getTokenFromRequest, safeEqual };
