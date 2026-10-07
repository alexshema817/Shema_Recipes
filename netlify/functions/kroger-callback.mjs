// GET /api/kroger/callback?code=...&state=...
// Public (no app session required by spec) but the state must match the signed
// cookie set by /api/kroger/auth, so only the browser that started the flow can finish it.
import { parseCookies, verifySignedToken, clearStateCookie, STATE_COOKIE } from "../lib/auth.mjs";
import { redirect } from "../lib/http.mjs";
import { publicHandler } from "../lib/handler.mjs";
import { exchangeCode } from "../lib/kroger.mjs";

function back(req, params) {
  const q = new URLSearchParams(params).toString();
  return redirect(`/?${q}#grocery`, 302, { "set-cookie": clearStateCookie(req) });
}

export default publicHandler(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  if (error) return back(req, { kroger: "error", message: url.searchParams.get("error_description") || error });
  if (!code || !state) return back(req, { kroger: "error", message: "Missing code or state" });

  const cookieState = parseCookies(req)[STATE_COOKIE];
  const data = verifySignedToken(state);
  if (!data || data.t !== "kroger-state" || cookieState !== state) {
    return back(req, { kroger: "error", message: "OAuth state mismatch. Please try connecting again." });
  }

  try {
    await exchangeCode(code);
    return back(req, { kroger: "connected" });
  } catch (err) {
    console.error("Kroger token exchange failed:", err);
    return back(req, { kroger: "error", message: err.message || "Token exchange failed" });
  }
});

export const config = { path: "/api/kroger/callback" };
