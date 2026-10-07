// POST /api/login  { username, password }
// Timing-safe credential check + failed-attempt rate limiting stored in Blobs.
// Failures are tracked per client IP (stored as a keyed hash, not the raw IP), so
// a stranger hammering the login can only lock out their own address.
import { createHmac } from "node:crypto";
import { checkCredentials, createSessionToken, sessionCookie } from "../lib/auth.mjs";
import { KEYS, readJSON, writeJSON } from "../lib/blobs.mjs";
import { json, fail, readBody, methodNotAllowed } from "../lib/http.mjs";
import { publicHandler } from "../lib/handler.mjs";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

function clientKey(req, context) {
  const ip = context?.ip || req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  return createHmac("sha256", process.env.SESSION_SECRET || "").update(`login:${ip}`).digest("base64url").slice(0, 22);
}

/** Drops entries with no recent failures and no active lock. */
function prune(byClient, now) {
  for (const [k, v] of Object.entries(byClient)) {
    const failures = (v.failures || []).filter((t) => now - t < WINDOW_MS);
    if (!failures.length && !(v.lockedUntil > now)) delete byClient[k];
    else byClient[k] = { failures, lockedUntil: v.lockedUntil || 0 };
  }
  return byClient;
}

export default publicHandler(async (req, context) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const body = await readBody(req);
  if (!body) return fail("Invalid JSON body");

  const now = Date.now();
  const key = clientKey(req, context);
  const stored = (await readJSON(KEYS.LOGIN_ATTEMPTS, null)) || {};
  const byClient = prune(stored.byClient && typeof stored.byClient === "object" ? stored.byClient : {}, now);
  const mine = byClient[key] || { failures: [], lockedUntil: 0 };

  if (mine.lockedUntil > now) {
    const retryAfter = Math.ceil((mine.lockedUntil - now) / 1000);
    return json({ error: `Too many failed logins. Try again in ${Math.ceil(retryAfter / 60)} min.`, retryAfterSeconds: retryAfter }, 429, {
      "retry-after": String(retryAfter),
    });
  }

  const ok = checkCredentials(String(body.username ?? ""), String(body.password ?? ""));
  if (!ok) {
    const failures = [...mine.failures, now];
    const lockedUntil = failures.length >= MAX_FAILURES ? now + LOCK_MS : 0;
    byClient[key] = { failures: lockedUntil ? [] : failures, lockedUntil };
    await writeJSON(KEYS.LOGIN_ATTEMPTS, { byClient });
    const left = Math.max(0, MAX_FAILURES - failures.length);
    return fail(lockedUntil ? "Too many failed logins. Locked for 15 minutes." : `Invalid username or password. ${left} attempt${left === 1 ? "" : "s"} left.`, 401);
  }

  delete byClient[key];
  await writeJSON(KEYS.LOGIN_ATTEMPTS, { byClient });
  const token = createSessionToken();
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, req) });
});

export const config = { path: "/api/login" };
