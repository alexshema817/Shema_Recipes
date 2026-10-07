// GET /api/kroger/auth - starts the Kroger OAuth2 authorization-code flow.
// A signed, short-lived state value is stored in a cookie to prevent CSRF.
import { createSignedToken, stateCookie, requireSession } from "../lib/auth.mjs";
import { redirect } from "../lib/http.mjs";
import { publicHandler } from "../lib/handler.mjs";
import { buildAuthorizeUrl } from "../lib/kroger.mjs";

export default publicHandler(async (req) => {
  const denied = requireSession(req);
  if (denied) return redirect("/login.html");
  const state = createSignedToken({ t: "kroger-state" }, 10 * 60 * 1000);
  return redirect(buildAuthorizeUrl(state), 302, { "set-cookie": stateCookie(state, req) });
});

export const config = { path: "/api/kroger/auth" };
