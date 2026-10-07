// Product search / lookup at the saved store (client-credentials token), used by
// the Preferences tab to pin a product.
//   GET /api/kroger/products?term=whole%20milk -> { products: [...], locationId }
//   GET /api/kroger/products?id=0087525200017  -> { product | null, locationId }
import { json, fail, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { getSettings } from "../lib/blobs.mjs";
import { searchProducts, getProduct, cleanSearchTerm, normalizeProductId } from "../lib/kroger.mjs";

export default protectedHandler(async (req) => {
  if (req.method !== "GET") return methodNotAllowed(["GET"]);
  const params = new URL(req.url).searchParams;
  const settings = await getSettings();

  const id = normalizeProductId(params.get("id"));
  if (params.has("id")) {
    if (!/^\d{8,14}$/.test(id)) return fail("Enter an 8-14 digit UPC or Kroger product ID");
    const product = await getProduct(id, settings.locationId);
    return json({ product, id, locationId: settings.locationId });
  }

  const raw = String(params.get("term") || "").trim();
  if (raw.length < 2) return fail("Enter at least 2 characters to search");
  const term = cleanSearchTerm(raw.slice(0, 120));
  const limit = Math.max(1, Math.min(10, Number(params.get("limit")) || 8));
  const products = await searchProducts(term, settings.locationId, limit);
  return json({ products, term, locationId: settings.locationId, locationName: settings.locationName });
});

export const config = { path: "/api/kroger/products" };
