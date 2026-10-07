// Background function: POST /api/build-list-background { jobId }
// Scales the flagged recipes, asks Claude to consolidate them into a grocery
// list, saves it as `grocery-list`, and marks the job done.
import { requireSession } from "../lib/auth.mjs";
import { readBody } from "../lib/http.mjs";
import { KEYS, readJSON, writeJSON, getSettings } from "../lib/blobs.mjs";
import { getJob, updateJob } from "../lib/jobs.mjs";
import { consolidateGroceryList } from "../lib/ai.mjs";

function roundQty(n) {
  return Math.round(n * 100) / 100;
}

export function isStaple(name, staples) {
  const n = String(name).toLowerCase().trim();
  return staples.some((s) => {
    const st = String(s).toLowerCase().trim();
    if (!st) return false;
    if (n === st) return true;
    return new RegExp(`(^|\\s)${st.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(n);
  });
}

export default async (req) => {
  const denied = requireSession(req);
  if (denied) return denied;
  const body = await readBody(req);
  const jobId = body?.jobId;
  if (!jobId) return new Response("jobId required", { status: 400 });
  const job = await getJob(jobId);
  if (!job || job.type !== "build-list") return new Response("Unknown job", { status: 404 });
  if (job.status !== "pending") return new Response("Job already started", { status: 409 });

  await updateJob(jobId, { status: "running" });
  try {
    const includeStaples = !!job.params?.includeStaples;
    const week = (await readJSON(KEYS.WEEK, null)) || { items: [] };
    const settings = await getSettings();
    const staples = includeStaples ? [] : settings.pantryStaples;

    const recipes = [];
    for (const w of week.items || []) {
      const r = await readJSON(KEYS.recipe(w.id), null);
      if (!r) continue;
      const multiplier = Number(w.multiplier) > 0 ? Number(w.multiplier) : 1;
      recipes.push({
        title: r.title,
        multiplier,
        ingredients: r.ingredients
          .filter((i) => i.item || i.raw)
          .map((i) => ({
            quantity: i.quantity != null ? roundQty(i.quantity * multiplier) : null,
            unit: i.unit || "",
            item: i.item || i.raw,
            note: i.note || "",
          })),
      });
    }
    if (!recipes.length) throw new Error("None of the flagged recipes could be loaded.");

    let items = await consolidateGroceryList(recipes, staples);
    if (!includeStaples && staples.length) items = items.filter((it) => !isStaple(it.name, staples));

    const list = { items, generatedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), fromWeek: recipes.map((r) => r.title) };
    await writeJSON(KEYS.GROCERY_LIST, list);
    await updateJob(jobId, { status: "done", result: { count: items.length }, error: null });
  } catch (err) {
    console.error("build-list-background failed:", err);
    await updateJob(jobId, { status: "error", error: err?.message || "Building the list failed" });
  }
  return new Response(null, { status: 202 });
};

export const config = { path: "/api/build-list-background", background: true };
