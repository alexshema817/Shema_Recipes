// POST /api/kroger/match { items: [{ id, name }] }
// Searches Kroger products for each item (top 3 at the saved store) and
// pre-selects the UPC remembered for that ingredient name.
import { json, fail, readBody, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { KEYS, readJSON, getSettings } from "../lib/blobs.mjs";
import { searchProducts, cleanSearchTerm, normalizeName } from "../lib/kroger.mjs";

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

export default protectedHandler(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const body = await readBody(req);
  const items = Array.isArray(body?.items) ? body.items.filter((i) => i && i.name).slice(0, 80) : [];
  if (!items.length) return fail("No items to match");

  const settings = await getSettings();
  if (!settings.locationId) return fail("Choose a Kroger store first (Settings or the Grocery tab).", 422, { code: "NO_LOCATION" });
  const productMap = (await readJSON(KEYS.KROGER_PRODUCT_MAP, null)) || {};

  const results = await mapLimit(items, 4, async (it) => {
    const term = cleanSearchTerm(it.name);
    const remembered = productMap[normalizeName(it.name)] || null;
    try {
      let options = await searchProducts(term, settings.locationId, 3);
      if (remembered?.upc && !options.some((o) => o.upc === remembered.upc)) {
        options = [{ upc: remembered.upc, description: remembered.description || "Previously chosen product", brand: remembered.brand || "", size: remembered.size || "", price: null, remembered: true }, ...options].slice(0, 4);
      }
      return { itemId: it.id, name: it.name, term, options, selectedUpc: remembered?.upc && options.some((o) => o.upc === remembered.upc) ? remembered.upc : options[0]?.upc || null, remembered: !!remembered?.upc };
    } catch (err) {
      return { itemId: it.id, name: it.name, term, options: [], selectedUpc: null, error: err.message };
    }
  });

  return json({ results, locationId: settings.locationId, locationName: settings.locationName });
});

export const config = { path: "/api/kroger/match" };
