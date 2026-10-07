// GET /api/kroger/locations?zip=12345 -> { locations: [{ locationId, name, chain, address }] }
import { json, fail, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { searchLocations } from "../lib/kroger.mjs";

export default protectedHandler(async (req) => {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);
  const zip = new URL(req.url).searchParams.get("zip") || "";
  if (!/^\d{5}$/.test(zip.trim())) return fail("Enter a 5-digit ZIP code");
  const locations = await searchLocations(zip.trim(), 10);
  return json({ locations });
});

export const config = { path: "/api/kroger/locations" };
