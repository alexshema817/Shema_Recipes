// POST /api/kroger/cart { items: [{ itemId, name, upc, quantity, description, size, brand }] }
// Saves the ingredient-name -> UPC picks, then PUT /v1/cart/add per item so we
// can report success/failure individually. Checkout happens in the Kroger app.
import { json, fail, readBody, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { KEYS, readJSON, writeJSON } from "../lib/blobs.mjs";
import { addToCart, normalizeName } from "../lib/kroger.mjs";

export default protectedHandler(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const body = await readBody(req);
  const items = Array.isArray(body?.items) ? body.items.filter((i) => i && /^\d{8,14}$/.test(String(i.upc || ""))).slice(0, 100) : [];
  if (!items.length) return fail("No items with a selected Kroger product");

  // Remember picks for next time.
  const productMap = (await readJSON(KEYS.KROGER_PRODUCT_MAP, null)) || {};
  for (const it of items) {
    const key = normalizeName(it.name);
    if (!key) continue;
    productMap[key] = { upc: String(it.upc), description: String(it.description || "").slice(0, 160), size: String(it.size || "").slice(0, 60), brand: String(it.brand || "").slice(0, 60), savedAt: new Date().toISOString() };
  }
  await writeJSON(KEYS.KROGER_PRODUCT_MAP, productMap);

  const results = [];
  for (const it of items) {
    const quantity = Math.max(1, Math.min(99, Math.round(Number(it.quantity) || 1)));
    try {
      await addToCart([{ upc: String(it.upc), quantity, modality: "PICKUP" }]);
      results.push({ itemId: it.itemId, name: it.name, upc: String(it.upc), quantity, ok: true });
    } catch (err) {
      if (err.code === "KROGER_NOT_CONNECTED") throw err;
      results.push({ itemId: it.itemId, name: it.name, upc: String(it.upc), quantity, ok: false, error: err.message });
    }
  }
  const added = results.filter((r) => r.ok).length;
  return json({ results, added, failed: results.length - added });
});

export const config = { path: "/api/kroger/cart" };
