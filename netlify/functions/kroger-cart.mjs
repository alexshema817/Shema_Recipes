// POST /api/kroger/cart { items: [{ itemId, name, upc, quantity, description, size, brand }] }
// PUT /v1/cart/add per item so we
// can report success/failure individually. Checkout happens in the Kroger app.
import { json, fail, readBody, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { addToCart } from "../lib/kroger.mjs";

export default protectedHandler(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const body = await readBody(req);
  const items = Array.isArray(body?.items) ? body.items.filter((i) => i && /^\d{8,14}$/.test(String(i.upc || ""))).slice(0, 100) : [];
  if (!items.length) return fail("No items with a selected Kroger product");

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
