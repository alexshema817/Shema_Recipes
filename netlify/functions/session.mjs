// GET /api/session - 200 when the session cookie is valid, 401 otherwise.
import { json } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";

export default protectedHandler(async () => {
  return json({ ok: true, username: process.env.APP_USERNAME || "" });
});

export const config = { path: "/api/session" };
