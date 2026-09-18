// Shared auth for the online 3D Price admin.
// Mirrors the Makeratlas pattern: scrypt password hash + signed session cookie
// for the owner, and a bearer token for the local worker.

const crypto = require("node:crypto");

const COOKIE = "3dprice_owner";
const MAX_AGE = 8 * 60 * 60; // 8 hours

function authReady() {
  return !!(process.env.OWNER_PASSWORD_HASH && process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32);
}

function verifyPassword(password) {
  if (!authReady()) return false;
  const [salt, hash] = String(process.env.OWNER_PASSWORD_HASH).split(":");
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password || ""), salt, 64).toString("hex");
  const a = Buffer.from(test);
  const b = Buffer.from(hash);
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(body).digest("base64url");
  return body + "." + sig;
}

function verify(token) {
  if (!token || !process.env.SESSION_SECRET) return null;
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.role !== "owner" || !payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  String(header || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i < 0) return;
    const key = part.slice(0, i).trim();
    out[key] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function ownerFromHeaders(headers = {}) {
  const cookies = parseCookies(headers.cookie || headers.Cookie);
  return verify(cookies[COOKIE]);
}

function isSameOrigin(event) {
  const origin = event.headers.origin || event.headers.Origin;
  if (!origin) return true; // same-origin page requests usually do not send Origin
  const host = event.headers.host;
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch (_) {
    return false;
  }
}

function workerAuth(event) {
  const token = process.env.INGEST_TOKEN;
  if (!token || token.length < 16) return false;
  const header = event.headers.authorization || event.headers.Authorization || "";
  const supplied = String(header).replace(/^Bearer\s+/i, "");
  const a = Buffer.from(supplied);
  const b = Buffer.from(token);
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

module.exports = {
  COOKIE,
  MAX_AGE,
  authReady,
  verifyPassword,
  sign,
  verify,
  parseCookies,
  ownerFromHeaders,
  isSameOrigin,
  workerAuth
};
