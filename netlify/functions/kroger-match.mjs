// POST /api/kroger/match { items: [{ id, name }] }
// Searches Kroger products for each item (top 3 at the saved store). When a
// preference matches the item name (lib/preferences.mjs), its hint is added to
// the search term and its pinned product is offered and pre-selected - fetched
// by productId/UPC when it is not among the search results, or injected from the
// saved snapshot if the lookup fails.
import { json, fail, readBody, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { getSettings } from "../lib/blobs.mjs";
import { searchProducts, getProduct, cleanSearchTerm } from "../lib/kroger.mjs";
import { loadPreferences, findPreference, buildHintedTerm } from "../lib/preferences.mjs";

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

function publicPreference(pref) {
  if (!pref) return null;
  const out = { term: pref.term, source: pref.source || "learned" };
  if (pref.hint) out.hint = pref.hint;
  if (pref.product?.upc) out.product = { upc: pref.product.upc, description: pref.product.description || "", brand: pref.product.brand || "", size: pref.product.size || "" };
  return out;
}

export default protectedHandler(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const body = await readBody(req);
  const items = Array.isArray(body?.items) ? body.items.filter((i) => i && i.name).slice(0, 80) : [];
  if (!items.length) return fail("No items to match");

  const settings = await getSettings();
  if (!settings.locationId) return fail("Choose a Kroger store first (Settings or the Grocery tab).", 422, { code: "NO_LOCATION" });
  const prefs = await loadPreferences();

  const results = await mapLimit(items, 4, async (it) => {
    const baseTerm = cleanSearchTerm(it.name);
    const pref = findPreference(prefs, it.name)?.preference || null;
    const pinned = pref?.product?.upc ? pref.product : null;
    let term = pref?.hint ? buildHintedTerm(it.name, pref.hint) : baseTerm;
    try {
      let options = await searchProducts(term, settings.locationId, 3);
      if (!options.length && term !== baseTerm) {
        // The hinted search found nothing - fall back to the plain item words.
        term = baseTerm;
        options = await searchProducts(term, settings.locationId, 3);
      }
      if (pinned) {
        const hit = options.find((o) => o.upc === pinned.upc);
        if (hit) hit.pinned = true;
        else {
          const live = await getProduct(pinned.productId || pinned.upc, settings.locationId).catch(() => null);
          const option = live
            ? { ...live, pinned: true }
            : { upc: pinned.upc, productId: pinned.productId, description: pinned.description || "Pinned product", brand: pinned.brand || "", size: pinned.size || "", price: null, pinned: true, snapshot: true };
          options = [option, ...options].slice(0, 4);
        }
      }
      const selected = options.find((o) => o.pinned) || options[0] || null;
      return { itemId: it.id, name: it.name, term, options, selectedUpc: selected?.upc || null, preference: publicPreference(pref) };
    } catch (err) {
      return { itemId: it.id, name: it.name, term, options: [], selectedUpc: null, error: err.message, preference: publicPreference(pref) };
    }
  });

  return json({ results, locationId: settings.locationId, locationName: settings.locationName });
});

export const config = { path: "/api/kroger/match" };
