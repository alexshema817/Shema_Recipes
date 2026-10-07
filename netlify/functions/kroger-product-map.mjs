// GET    /api/kroger/product-map -> remembered ingredient -> product picks
// DELETE /api/kroger/product-map -> forget all picks (or ?name=... for one)
import { json, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { KEYS, readJSON, writeJSON, remove } from "../lib/blobs.mjs";

export default protectedHandler(async (req) => {
  if (req.method === "GET") {
    const map = (await readJSON(KEYS.KROGER_PRODUCT_MAP, null)) || {};
    return json({ map, count: Object.keys(map).length });
  }
  if (req.method === "DELETE") {
    const name = new URL(req.url).searchParams.get("name");
    if (name) {
      const map = (await readJSON(KEYS.KROGER_PRODUCT_MAP, null)) || {};
      delete map[name];
      await writeJSON(KEYS.KROGER_PRODUCT_MAP, map);
      return json({ ok: true, count: Object.keys(map).length });
    }
    await remove(KEYS.KROGER_PRODUCT_MAP);
    return json({ ok: true, count: 0 });
  }
  return methodNotAllowed(["GET", "DELETE"]);
});

export const config = { path: "/api/kroger/product-map" };
