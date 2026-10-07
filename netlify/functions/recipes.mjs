// Recipe CRUD.
//   GET    /api/recipes        -> lightweight index for the library view
//   POST   /api/recipes        -> create (body: recipe)
//   GET    /api/recipes/:id    -> full recipe
//   PUT    /api/recipes/:id    -> update
//   DELETE /api/recipes/:id    -> delete (also unflags from This Week)
import { randomUUID } from "node:crypto";
import { KEYS, readJSON, writeJSON, remove } from "../lib/blobs.mjs";
import { json, fail, readBody, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { validateRecipe } from "../lib/recipe-parser.mjs";

function indexEntry(recipe) {
  return {
    id: recipe.id,
    title: recipe.title,
    tags: recipe.tags,
    ingredients: recipe.ingredients.map((i) => i.item).filter(Boolean),
    servings: recipe.servings,
    sourceUrl: recipe.sourceUrl,
    source: recipe.source,
    createdAt: recipe.createdAt,
    updatedAt: recipe.updatedAt,
  };
}

async function upsertIndex(recipe) {
  const index = (await readJSON(KEYS.RECIPES_INDEX, [])) || [];
  const i = index.findIndex((e) => e.id === recipe.id);
  const entry = indexEntry(recipe);
  if (i >= 0) index[i] = entry;
  else index.unshift(entry);
  await writeJSON(KEYS.RECIPES_INDEX, index);
}

export default protectedHandler(async (req, context) => {
  const id = context.params?.id;

  if (!id) {
    if (req.method === "GET") {
      const index = (await readJSON(KEYS.RECIPES_INDEX, [])) || [];
      return json({ recipes: index });
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      if (!body) return fail("Invalid JSON body");
      const { ok, errors, recipe } = validateRecipe(body);
      if (!ok) return fail(`Invalid recipe: ${errors.join("; ")}`);
      const now = new Date().toISOString();
      const saved = { id: randomUUID(), ...recipe, source: ["jsonld", "ai", "manual"].includes(body.source) ? body.source : "manual", createdAt: now, updatedAt: now };
      await writeJSON(KEYS.recipe(saved.id), saved);
      await upsertIndex(saved);
      return json({ recipe: saved }, 201);
    }
    return methodNotAllowed(["GET", "POST"]);
  }

  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Invalid recipe id", 404);
  const existing = await readJSON(KEYS.recipe(id), null);
  if (!existing) return fail("Recipe not found", 404);

  if (req.method === "GET") return json({ recipe: existing });

  if (req.method === "PUT") {
    const body = await readBody(req);
    if (!body) return fail("Invalid JSON body");
    const { ok, errors, recipe } = validateRecipe(body);
    if (!ok) return fail(`Invalid recipe: ${errors.join("; ")}`);
    const saved = { ...existing, ...recipe, id, updatedAt: new Date().toISOString() };
    await writeJSON(KEYS.recipe(id), saved);
    await upsertIndex(saved);
    return json({ recipe: saved });
  }

  if (req.method === "DELETE") {
    await remove(KEYS.recipe(id));
    const index = ((await readJSON(KEYS.RECIPES_INDEX, [])) || []).filter((e) => e.id !== id);
    await writeJSON(KEYS.RECIPES_INDEX, index);
    const week = (await readJSON(KEYS.WEEK, { items: [] })) || { items: [] };
    if (Array.isArray(week.items) && week.items.some((w) => w.id === id)) {
      week.items = week.items.filter((w) => w.id !== id);
      await writeJSON(KEYS.WEEK, week);
    }
    return json({ ok: true });
  }

  return methodNotAllowed(["GET", "PUT", "DELETE"]);
});

export const config = { path: ["/api/recipes", "/api/recipes/:id"] };
