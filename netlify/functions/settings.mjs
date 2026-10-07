// Settings: pantry staples + chosen Kroger store.
//   GET /api/settings
//   PUT /api/settings { pantryStaples?, locationId?, locationName? }
import { KEYS, writeJSON, getSettings } from "../lib/blobs.mjs";
import { json, fail, readBody, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";

export default protectedHandler(async (req) => {
  const current = await getSettings();
  if (req.method === "GET") return json({ settings: current });
  if (req.method === "PUT") {
    const body = await readBody(req);
    if (!body) return fail("Invalid JSON body");
    const next = { ...current };
    if (Array.isArray(body.pantryStaples)) {
      const seen = new Set();
      next.pantryStaples = body.pantryStaples
        .map((s) => String(s).toLowerCase().replace(/\s+/g, " ").trim())
        .filter((s) => s && s.length <= 60 && !seen.has(s) && seen.add(s))
        .slice(0, 300);
    }
    if (typeof body.locationId === "string") next.locationId = body.locationId.trim().slice(0, 20);
    if (typeof body.locationName === "string") next.locationName = body.locationName.trim().slice(0, 160);
    await writeJSON(KEYS.SETTINGS, next);
    return json({ settings: next });
  }
  return methodNotAllowed(["GET", "PUT"]);
});

export const config = { path: "/api/settings" };
