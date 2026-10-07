// This Week flags.
//   GET /api/week            -> { items: [{ id, multiplier, title, servings }] }
//   PUT /api/week            -> replace { items: [{ id, multiplier }] }
//   POST /api/week/toggle    -> { id } flips the flag; returns new state
import { KEYS, readJSON, writeJSON } from "../lib/blobs.mjs";
import { json, fail, readBody, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";

function clampMultiplier(m) {
  const n = Number(m);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(20, Math.round(n * 4) / 4);
}

async function load() {
  const week = (await readJSON(KEYS.WEEK, null)) || { items: [] };
  if (!Array.isArray(week.items)) week.items = [];
  return week;
}

async function withTitles(week) {
  const index = (await readJSON(KEYS.RECIPES_INDEX, [])) || [];
  const byId = new Map(index.map((e) => [e.id, e]));
  const items = week.items
    .filter((w) => byId.has(w.id))
    .map((w) => ({ id: w.id, multiplier: clampMultiplier(w.multiplier), title: byId.get(w.id).title, servings: byId.get(w.id).servings || "", tags: byId.get(w.id).tags || [] }));
  return { items };
}

export default protectedHandler(async (req, context) => {
  const action = context.params?.action;
  const week = await load();

  if (req.method === "GET" && !action) return json(await withTitles(week));

  if (req.method === "PUT" && !action) {
    const body = await readBody(req);
    if (!body || !Array.isArray(body.items)) return fail("Body must be { items: [{ id, multiplier }] }");
    const seen = new Set();
    week.items = body.items
      .filter((w) => w && typeof w.id === "string" && !seen.has(w.id) && seen.add(w.id))
      .map((w) => ({ id: w.id, multiplier: clampMultiplier(w.multiplier) }));
    await writeJSON(KEYS.WEEK, week);
    return json(await withTitles(week));
  }

  if (req.method === "POST" && action === "toggle") {
    const body = await readBody(req);
    const id = body?.id;
    if (!id) return fail("id required");
    const i = week.items.findIndex((w) => w.id === id);
    if (i >= 0) week.items.splice(i, 1);
    else week.items.push({ id, multiplier: 1 });
    await writeJSON(KEYS.WEEK, week);
    return json({ flagged: i < 0, ...(await withTitles(week)) });
  }

  return methodNotAllowed(["GET", "PUT", "POST"]);
});

export const config = { path: ["/api/week", "/api/week/:action"] };
