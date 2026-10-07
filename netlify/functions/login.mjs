// POST /api/login  { username, password }
// Timing-safe credential check + failed-attempt rate limiting stored in Blobs.
import { checkCredentials, createSessionToken, sessionCookie } from "../lib/auth.mjs";
import { KEYS, readJSON, writeJSON } from "../lib/blobs.mjs";
import { json, fail, readBody, methodNotAllowed } from "../lib/http.mjs";
import { publicHandler } from "../lib/handler.mjs";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

export default publicHandler(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const body = await readBody(req);
  if (!body) return fail("Invalid JSON body");

  const now = Date.now();
  const attempts = (await readJSON(KEYS.LOGIN_ATTEMPTS, null)) || { failures: [], lockedUntil: 0 };
  if (attempts.lockedUntil > now) {
    const retryAfter = Math.ceil((attempts.lockedUntil - now) / 1000);
    return json({ error: `Too many failed logins. Try again in ${Math.ceil(retryAfter / 60)} min.`, retryAfterSeconds: retryAfter }, 429, {
      "retry-after": String(retryAfter),
    });
  }

  const ok = checkCredentials(String(body.username ?? ""), String(body.password ?? ""));
  if (!ok) {
    const failures = (attempts.failures || []).filter((t) => now - t < WINDOW_MS);
    failures.push(now);
    const lockedUntil = failures.length >= MAX_FAILURES ? now + LOCK_MS : 0;
    await writeJSON(KEYS.LOGIN_ATTEMPTS, { failures: lockedUntil ? [] : failures, lockedUntil });
    const left = Math.max(0, MAX_FAILURES - failures.length);
    return fail(lockedUntil ? "Too many failed logins. Locked for 15 minutes." : `Invalid username or password. ${left} attempt${left === 1 ? "" : "s"} left.`, 401);
  }

  await writeJSON(KEYS.LOGIN_ATTEMPTS, { failures: [], lockedUntil: 0 });
  const token = createSessionToken();
  return json({ ok: true }, 200, { "set-cookie": sessionCookie(token, req) });
});

export const config = { path: "/api/login" };
