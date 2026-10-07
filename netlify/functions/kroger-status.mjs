// GET    /api/kroger/status -> { connected, expiresAt, locationId, locationName, configured }
// DELETE /api/kroger/status -> disconnect (delete stored tokens)
import { json, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { getSettings } from "../lib/blobs.mjs";
import { getUserTokens, disconnect } from "../lib/kroger.mjs";

export default protectedHandler(async (req) => {
  if (req.method === "DELETE") {
    await disconnect();
    return json({ ok: true, connected: false });
  }
  if (req.method !== "GET") return methodNotAllowed(["GET", "DELETE"]);
  const tokens = await getUserTokens();
  const settings = await getSettings();
  return json({
    connected: !!(tokens && (tokens.refreshToken || (tokens.accessToken && tokens.expiresAt > Date.now()))),
    expiresAt: tokens?.expiresAt || null,
    connectedAt: tokens?.connectedAt || null,
    locationId: settings.locationId,
    locationName: settings.locationName,
    configured: !!(process.env.KROGER_CLIENT_ID && process.env.KROGER_CLIENT_SECRET && process.env.KROGER_REDIRECT_URI),
  });
});

export const config = { path: "/api/kroger/status" };
