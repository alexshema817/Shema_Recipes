// POST /api/logout - clears the session cookie.
import { clearSessionCookie } from "../lib/auth.mjs";
import { json } from "../lib/http.mjs";
import { publicHandler } from "../lib/handler.mjs";

export default publicHandler(async (req) => {
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(req) });
});

export const config = { path: "/api/logout" };
