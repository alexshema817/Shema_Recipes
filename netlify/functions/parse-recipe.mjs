// POST /api/parse  { url } | { text }
// URL: fetch page -> JSON-LD Recipe (no AI) -> else reduce to text and hand
// off to the background AI parser. Responds with either
//   { status: "done", recipe, method: "jsonld" }
//   { status: "needs_ai", jobId, payload: { text, sourceUrl } }  (frontend posts payload to /api/parse-background)
import { fail, json, readBody, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { fetchPage, extractRecipeFromHtml, reduceHtmlToText, validateRecipe } from "../lib/recipe-parser.mjs";
import { createJob } from "../lib/jobs.mjs";

const MAX_TEXT = 40000;

export default protectedHandler(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const body = await readBody(req);
  if (!body) return fail("Invalid JSON body");

  if (body.url) {
    let url;
    try {
      url = new URL(String(body.url).trim()).href;
    } catch {
      return fail("That does not look like a valid URL");
    }
    const { html, finalUrl } = await fetchPage(url);
    const fromJsonLd = extractRecipeFromHtml(html, finalUrl || url);
    if (fromJsonLd) {
      const { ok, errors, recipe } = validateRecipe(fromJsonLd);
      if (ok) return json({ status: "done", method: "jsonld", recipe });
      console.warn("JSON-LD recipe rejected:", errors);
    }
    const text = reduceHtmlToText(html);
    if (text.length < 80) return fail("Could not read any recipe text from that page (it may require JavaScript or block bots). Try pasting the recipe text instead.", 422);
    const job = await createJob("parse-recipe", { sourceUrl: finalUrl || url });
    return json({ status: "needs_ai", jobId: job.id, payload: { text, sourceUrl: finalUrl || url } });
  }

  if (body.text) {
    const text = String(body.text).trim().slice(0, MAX_TEXT);
    if (text.length < 20) return fail("Paste a bit more text - that is too short to be a recipe.");
    const sourceUrl = typeof body.sourceUrl === "string" && /^https?:\/\//i.test(body.sourceUrl) ? body.sourceUrl.trim() : "";
    const job = await createJob("parse-recipe", { sourceUrl });
    return json({ status: "needs_ai", jobId: job.id, payload: { text, sourceUrl } });
  }

  return fail("Provide a url or text");
});

export const config = { path: "/api/parse" };
