// Kroger product preferences: ingredient term -> pinned product and/or search hint.
//
// Stored in Blobs under `preferences` as { [term]: Preference } where
//   Preference = { term, product?: { upc, productId?, description, brand, size, price? },
//                  hint?: string, source: "manual", updatedAt }
// `term` is always normalizeName()-d. Preferences are only ever created on the
// Preferences tab; items without one are matched by lowest unit price.
//
// The matching functions are pure (see scripts/test-preferences.mjs).
import { KEYS, readJSON, writeJSON } from "./blobs.mjs";
import { normalizeName, cleanSearchTerm } from "./kroger.mjs";

export const LIMITS = { termMin: 2, termMax: 60, hint: 80, description: 160, brand: 60, size: 60, productId: 20, maxWords: 8 };

// ---------------------------------------------------------------------------
// Matching (pure)
// ---------------------------------------------------------------------------

/** Crude singular form so "eggs" matches "egg", "tomatoes" "tomato", "berries" "berry". Applied to both sides, so it only has to be consistent. */
export function singular(word) {
  const w = String(word || "");
  if (w.length <= 3) return w;
  if (/ies$/.test(w)) return w.slice(0, -3) + "y";
  if (/(oes|ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
  if (/[^s]s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** Normalized, singularized words of a name. */
export function wordsOf(name) {
  return normalizeName(name).split(" ").filter(Boolean).map(singular);
}

/** True when `phrase` appears as a contiguous run of whole words inside `words`. */
export function containsPhrase(words, phrase) {
  if (!phrase.length || phrase.length > words.length) return false;
  outer: for (let i = 0; i + phrase.length <= words.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (words[i + j] !== phrase[j]) continue outer;
    return true;
  }
  return false;
}

/** Whole-word, in-order match: "milk" matches "whole milk" and "2% milk" but not "buttermilk". */
export function termMatchesName(term, name) {
  return containsPhrase(wordsOf(name), wordsOf(term));
}

/**
 * Finds the preference that applies to a list item name. An exact normalized
 * match wins outright; otherwise the matching term with the most words, then
 * the most characters, wins ("coconut milk" beats "milk" for "light coconut milk").
 * Returns { preference, exact } or null.
 */
export function findPreference(prefs, name) {
  const key = normalizeName(name);
  if (!key) return null;
  const list = Array.isArray(prefs) ? prefs : Object.values(prefs || {});
  const exact = list.find((p) => p && normalizeName(p.term) === key);
  if (exact) return { preference: exact, exact: true };
  const nameWords = wordsOf(key);
  let best = null;
  let bestWords = 0;
  for (const p of list) {
    if (!p?.term) continue;
    const tw = wordsOf(p.term);
    if (!containsPhrase(nameWords, tw)) continue;
    const better = !best || tw.length > bestWords || (tw.length === bestWords && p.term.length > best.term.length) || (tw.length === bestWords && p.term.length === best.term.length && p.term < best.term);
    if (better) {
      best = p;
      bestWords = tw.length;
    }
  }
  return best ? { preference: best, exact: false } : null;
}

/**
 * Kroger search term for an item plus a brand/keyword hint: the item's own words
 * first, then hint words until the 8-word limit. Words already present are not repeated.
 */
export function buildHintedTerm(name, hint, maxWords = LIMITS.maxWords) {
  const words = cleanSearchTerm(name).split(" ").filter(Boolean);
  for (const w of normalizeName(hint).split(" ").filter(Boolean)) {
    if (words.length >= maxWords) break;
    if (!words.includes(w)) words.push(w);
  }
  return cleanSearchTerm(words.join(" "));
}

// ---------------------------------------------------------------------------
// Validation / shaping (pure)
// ---------------------------------------------------------------------------

export function cleanProduct(p) {
  if (!p || typeof p !== "object") return null;
  const upc = String(p.upc || "").trim();
  if (!/^\d{8,14}$/.test(upc)) return null;
  const out = {
    upc,
    description: String(p.description || "").trim().slice(0, LIMITS.description),
    brand: String(p.brand || "").trim().slice(0, LIMITS.brand),
    size: String(p.size || "").trim().slice(0, LIMITS.size),
  };
  const productId = String(p.productId || "").trim().slice(0, LIMITS.productId);
  if (productId && /^[\w-]+$/.test(productId)) out.productId = productId;
  const price = Number(p.price);
  if (p.price != null && Number.isFinite(price) && price >= 0) out.price = Math.round(price * 100) / 100;
  return out;
}

/** Validates a PUT body. Returns { ok: true, preference } or { ok: false, error }. */
export function validatePreference(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid JSON body" };
  const term = normalizeName(body.term);
  if (term.length < LIMITS.termMin) return { ok: false, error: "Enter an ingredient term (at least 2 characters)" };
  if (term.length > LIMITS.termMax) return { ok: false, error: `The term must be ${LIMITS.termMax} characters or fewer` };
  const hint = typeof body.hint === "string" ? body.hint.replace(/\s+/g, " ").trim() : "";
  if (hint.length > LIMITS.hint) return { ok: false, error: `The hint must be ${LIMITS.hint} characters or fewer` };
  if (body.product != null && typeof body.product !== "object") return { ok: false, error: "Invalid product" };
  const product = body.product ? cleanProduct(body.product) : null;
  if (body.product && !product) return { ok: false, error: "The pinned product needs a valid UPC" };
  if (!product && !hint) return { ok: false, error: "Pin a product or enter a hint" };
  const preference = { term, source: "manual", updatedAt: new Date().toISOString() };
  if (product) preference.product = product;
  if (hint) preference.hint = hint;
  return { ok: true, preference };
}

/** Alphabetical list form used by the API. */
export function sortedPreferences(prefs) {
  return Object.values(prefs || {}).sort((a, b) => a.term.localeCompare(b.term));
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** Reads all preferences. */
export async function loadPreferences() {
  const prefs = await readJSON(KEYS.PREFERENCES, null);
  return prefs && typeof prefs === "object" ? prefs : {};
}

export async function savePreferences(prefs) {
  await writeJSON(KEYS.PREFERENCES, prefs);
}
