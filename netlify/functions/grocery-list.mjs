// Grocery list.
//   GET /api/grocery-list -> { items, generatedAt, updatedAt }
//   PUT /api/grocery-list -> replace { items }
import { KEYS, readJSON, writeJSON } from "../lib/blobs.mjs";
import { json, fail, readBody, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { parseQuantity } from "../lib/recipe-parser.mjs";
import { STORE_SECTIONS } from "../lib/ai.mjs";

function cleanItem(it, i) {
  if (!it || typeof it !== "object") return null;
  const name = String(it.name || "").replace(/\s+/g, " ").trim().slice(0, 120);
  if (!name) return null;
  return {
    id: String(it.id || `item-${i}-${Date.now().toString(36)}`).slice(0, 80),
    name,
    quantity: parseQuantity(it.quantity),
    unit: String(it.unit || "").trim().slice(0, 30),
    section: STORE_SECTIONS.includes(it.section) ? it.section : "Other",
    fromRecipes: Array.isArray(it.fromRecipes) ? it.fromRecipes.map(String).slice(0, 20) : [],
    checked: !!it.checked,
    manual: !!it.manual,
  };
}

export default protectedHandler(async (req) => {
  const list = (await readJSON(KEYS.GROCERY_LIST, null)) || { items: [], generatedAt: null, updatedAt: null };
  if (req.method === "GET") return json(list);
  if (req.method === "PUT") {
    const body = await readBody(req);
    if (!body || !Array.isArray(body.items)) return fail("Body must be { items: [...] }");
    const items = body.items.map(cleanItem).filter(Boolean);
    const next = { ...list, items, updatedAt: new Date().toISOString() };
    await writeJSON(KEYS.GROCERY_LIST, next);
    return json(next);
  }
  return methodNotAllowed(["GET", "PUT"]);
});

export const config = { path: "/api/grocery-list" };
