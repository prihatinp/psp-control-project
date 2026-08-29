/**
 * Auth.gs — token issue/verify (HMAC-SHA256, Script-Property-signed).
 *
 * IMPORTANT — Phase 1A dependency: login_() below assumes the existing
 * "Team" sheet has `name`, `role`, and `pin` columns and that PIN is
 * compared as plaintext, because the real production Code.gs (with the
 * actual PIN storage/hash and token scheme) was not recoverable in this
 * session — see backend/README.md "Phase 1A — what we could not recover".
 * DO NOT point this at the production spreadsheet or swap it in for the
 * live login until that assumption is confirmed or corrected against the
 * real script.
 */

function issueToken_(user) {
  const payload = { name: user.name, role: user.role, exp: Date.now() + 12 * 3600 * 1000 };
  const payloadStr = Utilities.base64EncodeWebSafe(JSON.stringify(payload));
  return payloadStr + '.' + signPayload_(payloadStr);
}

function signPayload_(payloadStr) {
  const secret = getScriptProp_('AUTH_SECRET');
  const raw = Utilities.computeHmacSha256Signature(payloadStr, secret);
  return Utilities.base64EncodeWebSafe(raw);
}

function AuthError_(message) {
  this.name = 'AuthError';
  this.message = message;
  this.authError = true;
}
AuthError_.prototype = Object.create(Error.prototype);

function verifyToken_(token) {
  if (!token || token.indexOf('.') === -1) throw new AuthError_('Token tidak valid');
  const parts = token.split('.');
  const payloadStr = parts[0], sig = parts[1];
  if (signPayload_(payloadStr) !== sig) throw new AuthError_('Token tidak valid');
  const payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(payloadStr)).getDataAsString());
  if (Date.now() > payload.exp) throw new AuthError_('Sesi berakhir, silakan login kembali');
  return payload;
}

/** Throws AuthError_ if the token is missing/invalid; otherwise returns {name, role}. */
function requireAuth_(token) {
  return verifyToken_(token);
}

/** Very coarse placeholder role check (role text contains "Head"/"Manager"). Replace with real RBAC once Phase 1A confirms whether any authorization exists today. */
function isManagementRole_(role) {
  return /head|manager|manajer|kepala/i.test(String(role || ''));
}

function login_(name, pin) {
  const user = findOne_('Team', u => String(u.name) === String(name));
  if (!user) throw new Error('Nama pengguna tidak ditemukan');
  if (user.pin === undefined) {
    throw new Error('Sheet "Team" tidak memiliki kolom "pin" yang diharapkan — verifikasi struktur asli pada Phase 1A sebelum melanjutkan.');
  }
  if (String(user.pin) !== String(pin)) {
    logAudit_(name, 'LOGIN_FAILED', 'USER', name, 'wrong PIN');
    throw new Error('PIN salah');
  }
  const token = issueToken_(user);
  logAudit_(user.name, 'LOGIN', 'USER', user.name, 'login success');
  return { token: token, user: { name: user.name, role: user.role } };
}
