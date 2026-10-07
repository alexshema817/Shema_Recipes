// Single-user auth: HMAC-signed session cookie + timing-safe credential check.
import { createHmac, createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { json } from "./http.mjs";

export const SESSION_COOKIE = "rk_session";
export const STATE_COOKIE = "rk_kroger_state";
const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET env var is missing or shorter than 16 characters");
  }
  return s;
}

function sign(payload) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

/** Constant-time string compare that does not leak length (compares SHA-256 digests). */
export function safeEqual(a, b) {
  const ha = createHash("sha256").update(String(a ?? "")).digest();
  const hb = createHash("sha256").update(String(b ?? "")).digest();
  return timingSafeEqual(ha, hb);
}

export function checkCredentials(username, password) {
  const expectedUser = process.env.APP_USERNAME;
  const expectedPass = process.env.APP_PASSWORD;
  if (!expectedUser || !expectedPass) {
    throw new Error("APP_USERNAME / APP_PASSWORD env vars are not configured");
  }
  // Evaluate both comparisons unconditionally so timing does not depend on which one failed.
  const userOk = safeEqual(username, expectedUser);
  const passOk = safeEqual(password, expectedPass);
  return userOk && passOk;
}

/** Signed token: base64url(JSON{iat,exp,nonce}).signature */
export function createSignedToken(data, ttlMs) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({ ...data, iat: now, exp: now + ttlMs, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifySignedToken(token) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const i = token.lastIndexOf(".");
  if (i <= 0) return null;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  let expected;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data.exp !== "number" || data.exp <= Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export function createSessionToken() {
  return createSignedToken({ t: "session" }, THIRTY_DAYS_SECONDS * 1000);
}

export function parseCookies(req) {
  const header = req.headers.get("cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function isAuthenticated(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;
  const data = verifySignedToken(token);
  return !!data && data.t === "session";
}

/** Returns null when the request carries a valid session, otherwise a 401 Response. */
export function requireSession(req) {
  if (isAuthenticated(req)) return null;
  return json({ error: "Unauthorized" }, 401);
}

/** `Secure` cookies are not accepted by every browser on plain http://localhost, so only add it off-localhost or on https. */
export function isSecureRequest(req) {
  try {
    const url = new URL(req.url);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return url.protocol === "https:" || !local;
  } catch {
    return true;
  }
}

function cookie(name, value, { maxAge, req }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (isSecureRequest(req)) parts.push("Secure");
  return parts.join("; ");
}

export function sessionCookie(token, req) {
  return cookie(SESSION_COOKIE, token, { maxAge: THIRTY_DAYS_SECONDS, req });
}

export function clearSessionCookie(req) {
  return cookie(SESSION_COOKIE, "", { maxAge: 0, req });
}

export function stateCookie(token, req) {
  return cookie(STATE_COOKIE, token, { maxAge: 600, req });
}

export function clearStateCookie(req) {
  return cookie(STATE_COOKIE, "", { maxAge: 0, req });
}
