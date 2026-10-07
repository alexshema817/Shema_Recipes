// Browser-side importer ("Send to Recipes" bookmarklet / iOS Shortcut) support.
// The importer collects ld+json blocks and readable text on the recipe page in the
// user's own browser and posts them here. Everything in the payload comes from a
// third-party page, so it is treated as untrusted input: sizes are capped, types
// are coerced, and the recipe goes through the same JSON-LD -> validateRecipe
// pipeline as /api/parse (image/video/author fields are dropped by construction).
import { parseJsonLdText, extractRecipeFromJsonLd, validateRecipe } from "./recipe-parser.mjs";

export const MAX_IMPORT_CHARS = 100_000; // url + title + jsonld + text
export const MAX_JSONLD_BLOCKS = 20;
export const MAX_TEXT = 40000; // same cap as the paste-text path
export const MIN_TEXT_FOR_AI = 200;
export const NO_RECIPE_MESSAGE = "Couldn't find a recipe on that page. Copy the recipe text and use Paste text.";

function str(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}

/** Coerces the raw request body into { url, title, jsonld, text }. Throws { httpStatus, message } on bad input. */
export function sanitizeImportBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw importError(400, "Invalid import payload");
  const rawJsonLd = Array.isArray(body.jsonld) ? body.jsonld : [];
  const rawText = typeof body.text === "string" ? body.text : "";
  const rawUrl = typeof body.url === "string" ? body.url : "";
  const rawTitle = typeof body.title === "string" ? body.title : "";

  const total = rawUrl.length + rawTitle.length + rawText.length + rawJsonLd.reduce((n, b) => n + (typeof b === "string" ? b.length : 0), 0);
  if (total > MAX_IMPORT_CHARS) throw importError(413, `Import payload is too large (${total} characters, limit ${MAX_IMPORT_CHARS}).`);

  let url = "";
  try {
    const u = new URL(rawUrl.trim());
    if (u.protocol === "http:" || u.protocol === "https:") url = u.href.slice(0, 1000);
  } catch {}

  return {
    url,
    title: str(rawTitle, 300).replace(/\s+/g, " ").trim(),
    jsonld: rawJsonLd.filter((b) => typeof b === "string" && b.trim()).slice(0, MAX_JSONLD_BLOCKS),
    text: rawText.trim().slice(0, MAX_TEXT),
  };
}

/**
 * Pure decision step (no I/O). Returns one of
 *   { status: "done", method: "jsonld", recipe }
 *   { status: "needs_ai", payload: { text, sourceUrl } }   (caller creates the job)
 *   { status: "error", error, httpStatus }
 */
export function decideImport(body) {
  let input;
  try {
    input = sanitizeImportBody(body);
  } catch (err) {
    return { status: "error", error: err.message, httpStatus: err.httpStatus || 400 };
  }
  const { url, title, jsonld, text } = input;

  const blocks = jsonld.map(parseJsonLdText).filter((b) => b !== undefined);
  const fromJsonLd = blocks.length ? extractRecipeFromJsonLd(blocks, url) : null;
  if (fromJsonLd) {
    fromJsonLd.sourceUrl = url;
    const { ok, errors, recipe } = validateRecipe(fromJsonLd);
    if (ok) return { status: "done", method: "jsonld", recipe };
    console.warn("Imported JSON-LD recipe rejected:", errors);
  }

  if (text.length >= MIN_TEXT_FOR_AI) {
    const withTitle = title && !text.slice(0, 500).includes(title) ? `${title}\n\n${text}` : text;
    return { status: "needs_ai", payload: { text: withTitle.slice(0, MAX_TEXT), sourceUrl: url } };
  }

  return { status: "error", error: NO_RECIPE_MESSAGE, httpStatus: 422 };
}

function importError(httpStatus, message) {
  const err = new Error(message);
  err.httpStatus = httpStatus;
  return err;
}
