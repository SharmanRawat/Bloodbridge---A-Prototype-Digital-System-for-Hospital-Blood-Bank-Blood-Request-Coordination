const crypto = require('crypto');

const SCRYPT_PREFIX = 'scrypt';
const KEYLEN = 64;
const SALT_LEN = 16;
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// Format: scrypt$<saltHex>$<hashHex>
function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const derived = crypto.scryptSync(String(password), salt, KEYLEN, SCRYPT_OPTS);
  return `${SCRYPT_PREFIX}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

function isHashed(stored) {
  return typeof stored === 'string' && stored.startsWith(SCRYPT_PREFIX + '$');
}

// Backward-compatible verification:
//  - values stored as "scrypt$..." are verified against the scrypt hash
//  - legacy plaintext values are compared directly (so existing accounts keep
//    working). Existing rows are never modified by this function.
function verifyPassword(password, stored) {
  if (stored == null || password == null) return false;
  const s = String(stored);
  if (isHashed(s)) {
    const parts = s.split('$');
    if (parts.length !== 3) return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    if (!salt.length || !expected.length) return false;
    const derived = crypto.scryptSync(String(password), salt, expected.length, SCRYPT_OPTS);
    return expected.length === derived.length && crypto.timingSafeEqual(expected, derived);
  }
  const a = Buffer.from(String(password));
  const b = Buffer.from(s);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword, isHashed };
