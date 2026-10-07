// Kroger product preferences (ingredient term -> pinned product and/or search hint).
//   GET    /api/preferences                  -> { preferences: [...], count }
//   PUT    /api/preferences { term, hint?, product?, originalTerm? } -> upsert one (source "manual")
//   DELETE /api/preferences?term=milk        -> delete one
//   DELETE /api/preferences?source=learned   -> delete all auto-learned picks
import { json, fail, readBody, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { normalizeName } from "../lib/kroger.mjs";
import { loadPreferences, savePreferences, validatePreference, sortedPreferences } from "../lib/preferences.mjs";

export default protectedHandler(async (req) => {
  const prefs = await loadPreferences();

  if (req.method === "GET") {
    return json({ preferences: sortedPreferences(prefs), count: Object.keys(prefs).length });
  }

  if (req.method === "PUT") {
    const body = await readBody(req);
    if (!body) return fail("Invalid JSON body");
    const v = validatePreference(body);
    if (!v.ok) return fail(v.error);
    // Editing may rename the term; drop the old entry so it is not duplicated.
    const original = normalizeName(body.originalTerm);
    if (original && original !== v.preference.term) delete prefs[original];
    prefs[v.preference.term] = v.preference;
    await savePreferences(prefs);
    return json({ preference: v.preference, preferences: sortedPreferences(prefs), count: Object.keys(prefs).length });
  }

  if (req.method === "DELETE") {
    const params = new URL(req.url).searchParams;
    const term = normalizeName(params.get("term"));
    if (term) {
      if (!prefs[term]) return fail("No preference with that term", 404);
      delete prefs[term];
    } else if (params.get("source") === "learned") {
      for (const [k, p] of Object.entries(prefs)) if (p.source === "learned") delete prefs[k];
    } else {
      return fail("Specify ?term=... or ?source=learned");
    }
    await savePreferences(prefs);
    return json({ ok: true, preferences: sortedPreferences(prefs), count: Object.keys(prefs).length });
  }

  return methodNotAllowed(["GET", "PUT", "DELETE"]);
});

export const config = { path: "/api/preferences" };
