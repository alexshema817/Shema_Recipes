// Recipe parsing: page fetch, schema.org Recipe JSON-LD extraction, HTML -> text
// reduction for the AI fallback, ingredient-line heuristics, and validation.
// Pure Node (no DOM libraries) so it runs in Netlify Functions and in scripts.

import { assertPublicUrl } from "./net-guard.mjs";

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";

export const RECIPE_FIELDS = ["title", "sourceUrl", "servings", "prepTime", "cookTime", "ingredients", "instructions", "tags"];
export const INGREDIENT_FIELDS = ["raw", "quantity", "unit", "item", "note"];

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

const MAX_REDIRECTS = 5;

export async function fetchPage(url, { timeoutMs = 15000, maxBytes = 3_000_000 } = {}) {
  let u = await assertPublicUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // Redirects are followed by hand so every hop is checked against private addresses.
    let res;
    for (let hop = 0; ; hop++) {
      res = await requestPage(u, ctrl.signal);
      const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
      if (!location) break;
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects");
      await res.body?.cancel().catch(() => {});
      u = await assertPublicUrl(new URL(location, u));
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => "")).slice(0, 4000);
      const challenge = res.headers.get("cf-mitigated") === "challenge" || /just a moment|captcha|access denied|are you a human|verify you are|bot detection/i.test(body);
      if (challenge || res.status === 403 || res.status === 429 || res.status === 503) {
        throw new Error(`${u.hostname} blocks automated access (HTTP ${res.status}). Open the page in your browser, copy the recipe text, and use "Paste text" instead.`);
      }
      throw new Error(`The site returned HTTP ${res.status}`);
    }
    const type = res.headers.get("content-type") || "";
    if (type && !/html|xml|text/i.test(type)) throw new Error(`That URL is not an HTML page (${type.split(";")[0]})`);
    const buf = Buffer.from(await res.arrayBuffer());
    const html = buf.subarray(0, maxBytes).toString("utf8");
    return { html, finalUrl: u.href };
  } catch (err) {
    if (err.name === "AbortError") throw new Error("Timed out fetching the page");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function requestPage(u, signal) {
  return fetch(u, {
    headers: {
      "user-agent": BROWSER_UA,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "sec-ch-ua": '"Chromium";v="129", "Google Chrome";v="129", "Not=A?Brand";v="8"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-site": "none",
      "sec-fetch-user": "?1",
      "upgrade-insecure-requests": "1",
      "cache-control": "max-age=0",
    },
    redirect: "manual",
    signal,
  });
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", deg: "°", times: "×", frac12: "½", frac14: "¼", frac34: "¾",
  frac13: "⅓", frac23: "⅔", frac18: "⅛", frac38: "⅜", frac58: "⅝", frac78: "⅞", copy: "©", reg: "®", trade: "™",
  eacute: "é", egrave: "è", agrave: "à", ntilde: "ñ", ccedil: "ç", uuml: "ü", ouml: "ö", auml: "ä", iuml: "ï",
  middot: "·", bull: "•", laquo: "«", raquo: "»", shy: "",
};

export function decodeEntities(s) {
  return String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, name) => (name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : m));
}

function safeChar(code) {
  try {
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
  } catch {
    return "";
  }
}

export function stripTags(s) {
  return String(s ?? "").replace(/<[^>]+>/g, " ");
}

export function cleanText(s) {
  return decodeEntities(stripTags(s)).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// JSON-LD extraction
// ---------------------------------------------------------------------------

export function extractJsonLdBlocks(html) {
  const blocks = [];
  const re = /<script\b[^>]*type\s*=\s*["']?\s*application\/ld\+json\s*["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const parsed = parseJsonLdText(m[1]);
    if (parsed !== undefined) blocks.push(parsed);
  }
  return blocks;
}

/** Parses the text content of one ld+json script (tolerates HTML comment / CDATA wrappers). Returns undefined when unparseable. */
export function parseJsonLdText(text) {
  const raw = String(text ?? "")
    .trim()
    .replace(/^<!--/, "")
    .replace(/-->$/, "")
    .replace(/^\/\*\s*<!\[CDATA\[\s*\*\//, "")
    .replace(/\/\*\s*\]\]>\s*\*\/$/, "")
    .trim();
  if (!raw) return undefined;
  return tryParseJson(raw);
}

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {}
  // Raw control characters inside strings are a common site bug.
  try {
    return JSON.parse(raw.replace(/[\u0000-\u001f]+/g, " "));
  } catch {}
  // Several top-level objects pasted back to back.
  try {
    return JSON.parse(`[${raw.replace(/}\s*{/g, "},{")}]`);
  } catch {}
  return undefined;
}

export function hasType(node, type) {
  if (!node || typeof node !== "object") return false;
  const t = node["@type"];
  if (!t) return false;
  const arr = Array.isArray(t) ? t : [t];
  return arr.some((x) => typeof x === "string" && x.toLowerCase() === type.toLowerCase());
}

/** Walks any JSON-LD shape (plain object, @graph arrays, nested mainEntity, etc.) and collects Recipe nodes. */
export function findRecipeNodes(data, out = [], depth = 0) {
  if (data == null || depth > 10) return out;
  if (Array.isArray(data)) {
    for (const d of data) findRecipeNodes(d, out, depth + 1);
    return out;
  }
  if (typeof data !== "object") return out;
  if (hasType(data, "Recipe")) {
    out.push(data);
    return out;
  }
  for (const [key, value] of Object.entries(data)) {
    if (key === "@context") continue;
    if (value && typeof value === "object") findRecipeNodes(value, out, depth + 1);
  }
  return out;
}

export function flattenInstructions(instr, out = [], depth = 0) {
  if (instr == null || depth > 8) return out;
  if (typeof instr === "string") {
    for (const line of splitInstructionText(instr)) out.push(line);
    return out;
  }
  if (Array.isArray(instr)) {
    for (const i of instr) flattenInstructions(i, out, depth + 1);
    return out;
  }
  if (typeof instr === "object") {
    if (hasType(instr, "HowToSection") || (Array.isArray(instr.itemListElement) && !instr.text)) {
      flattenInstructions(instr.itemListElement, out, depth + 1);
      return out;
    }
    const text = instr.text ?? instr.description ?? instr.name;
    if (typeof text === "string") {
      for (const line of splitInstructionText(text)) out.push(line);
    } else if (instr.itemListElement) {
      flattenInstructions(instr.itemListElement, out, depth + 1);
    }
  }
  return out;
}

function splitInstructionText(text) {
  // Instructions can arrive as HTML (<p>/<li>/<br>) or as newline separated text.
  const withBreaks = String(text).replace(/<\s*(br|\/p|\/li|\/div)\b[^>]*>/gi, "\n");
  return decodeEntities(stripTags(withBreaks))
    .split(/\n+/)
    .map((s) => s.replace(/\s+/g, " ").replace(/^\s*(step\s*)?\d+[.):]\s*/i, "").trim())
    .filter((s) => s.length > 1);
}

export function formatIsoDuration(value) {
  if (value == null) return "";
  if (Array.isArray(value)) value = value[0];
  const s = String(value).trim();
  const m = s.match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!m) return cleanText(s);
  const days = Number(m[1] || 0);
  let hours = Number(m[2] || 0);
  let mins = Number(m[3] || 0);
  const secs = Number(m[4] || 0);
  hours += days * 24;
  if (mins >= 60) {
    hours += Math.floor(mins / 60);
    mins = mins % 60;
  }
  const parts = [];
  if (hours) parts.push(`${hours} hr`);
  if (mins) parts.push(`${Math.round(mins)} min`);
  if (!hours && !mins && secs) parts.push(`${Math.round(secs)} sec`);
  return parts.join(" ");
}

export function formatYield(value) {
  if (value == null) return "";
  if (Array.isArray(value)) {
    // Prefer the most descriptive entry (e.g. ["4", "4 servings"]).
    const strs = value.map((v) => cleanText(String(v))).filter(Boolean);
    strs.sort((a, b) => b.length - a.length);
    value = strs[0] ?? "";
  }
  if (typeof value === "object") value = value.value ?? value.text ?? "";
  return cleanText(String(value)).slice(0, 60);
}

function toStringList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(toStringList);
  if (typeof value === "object") return toStringList(value.name ?? value.text ?? "");
  return String(value)
    .split(",")
    .map((s) => cleanText(s))
    .filter(Boolean);
}

/** Converts a schema.org Recipe node into the app's recipe shape. Image/video/author fields are dropped by construction. */
export function recipeFromJsonLd(node, sourceUrl = "") {
  const ingredientsRaw = toStringList(node.recipeIngredient ?? node.ingredients ?? []);
  const ingredients = ingredientsRaw.map((raw) => parseIngredientLine(raw)).filter((i) => i.raw);
  const instructions = flattenInstructions(node.recipeInstructions);
  const tags = uniqueTags([
    ...toStringList(node.keywords),
    ...toStringList(node.recipeCategory),
    ...toStringList(node.recipeCuisine),
  ]);
  const title = cleanText(node.name ?? node.headline ?? "");
  return {
    title,
    sourceUrl: cleanText(node.mainEntityOfPage?.["@id"] ?? node.mainEntityOfPage ?? node.url ?? sourceUrl ?? "") || sourceUrl,
    servings: formatYield(node.recipeYield ?? node.yield),
    prepTime: formatIsoDuration(node.prepTime),
    cookTime: formatIsoDuration(node.cookTime ?? node.totalTime),
    ingredients,
    instructions,
    tags,
  };
}

function uniqueTags(list) {
  const seen = new Set();
  const out = [];
  for (const t of list) {
    const tag = String(t).toLowerCase().replace(/\s+/g, " ").trim();
    if (!tag || tag.length > 40 || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 12) break;
  }
  return out;
}

/** Full JSON-LD pipeline. Returns a recipe or null when the page has no usable Recipe JSON-LD. */
export function extractRecipeFromHtml(html, sourceUrl = "") {
  return extractRecipeFromJsonLd(extractJsonLdBlocks(html), sourceUrl);
}

/** Same as extractRecipeFromHtml but starts from already parsed JSON-LD blocks (used by the browser importer). */
export function extractRecipeFromJsonLd(blocks, sourceUrl = "") {
  const nodes = findRecipeNodes(blocks);
  if (!nodes.length) return null;
  // Prefer the node with the most ingredients.
  const scored = nodes
    .map((n) => ({ n, score: toStringList(n.recipeIngredient ?? n.ingredients ?? []).length }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score === 0) return null;
  const recipe = recipeFromJsonLd(best.n, sourceUrl);
  if (!recipe.sourceUrl || !/^https?:/i.test(recipe.sourceUrl)) recipe.sourceUrl = sourceUrl;
  return recipe;
}

// ---------------------------------------------------------------------------
// HTML -> reduced text (for the AI fallback)
// ---------------------------------------------------------------------------

export function reduceHtmlToText(html, maxChars = 12000) {
  let s = String(html);
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  s = s.replace(/<(script|style|noscript|svg|iframe|canvas|template|form|select|textarea|button|video|audio|picture)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<(nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<(div|section|ol|ul)\b[^>]*(?:id|class)\s*=\s*["'][^"']*(?:comment|sidebar|newsletter|advert|cookie-consent|breadcrumb)[^"']*["'][^>]*>[\s\S]*?<\/\1\s*>/gi, " ");

  let body = pickMainContent(s);
  body = body
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/blockquote|\/dd|\/dt)\b[^>]*>/gi, "\n")
    .replace(/<\s*li\b[^>]*>/gi, "\n- ")
    .replace(/<\s*h[1-6]\b[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");

  let text = decodeEntities(body)
    .replace(/[ \t \r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (text.length > maxChars) {
    // Keep the window around the ingredients heading, where the recipe lives.
    const idx = text.search(/\bingredients?\b/i);
    const start = idx > 0 ? Math.max(0, idx - Math.floor(maxChars * 0.15)) : 0;
    text = text.slice(start, start + maxChars);
  }
  return text;
}

function pickMainContent(s) {
  const candidates = [
    /<([a-z0-9-]+)\b[^>]*class\s*=\s*["'][^"']*(?:wprm-recipe-container|tasty-recipes|mv-create-card|recipe-card|recipe-content)[^"']*["'][^>]*>([\s\S]*?)<\/\1\s*>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main\s*>/i,
    /<article\b[^>]*>([\s\S]*?)<\/article\s*>/i,
  ];
  for (const re of candidates) {
    const m = s.match(re);
    const inner = m ? m[m.length - 1] : null;
    if (inner && stripTags(inner).replace(/\s+/g, " ").trim().length > 600) return inner;
  }
  const body = s.match(/<body\b[^>]*>([\s\S]*)<\/body\s*>/i);
  return body ? body[1] : s;
}

// ---------------------------------------------------------------------------
// Ingredient line heuristics
// ---------------------------------------------------------------------------

const UNICODE_FRACTIONS = {
  "½": "1/2", "⅓": "1/3", "⅔": "2/3", "¼": "1/4", "¾": "3/4", "⅛": "1/8", "⅜": "3/8", "⅝": "5/8", "⅞": "7/8", "⅕": "1/5", "⅙": "1/6",
};

const UNIT_ALIASES = [
  ["cup", ["cups", "cup", "c"]],
  ["tbsp", ["tablespoons", "tablespoon", "tbsps", "tbsp", "tbs", "tbl"]],
  ["tsp", ["teaspoons", "teaspoon", "tsps", "tsp"]],
  ["oz", ["ounces", "ounce", "oz"]],
  ["fl oz", ["fl oz", "fluid ounces", "fluid ounce"]],
  ["lb", ["pounds", "pound", "lbs", "lb"]],
  ["g", ["grams", "gram", "g"]],
  ["kg", ["kilograms", "kilogram", "kg"]],
  ["mg", ["milligrams", "milligram", "mg"]],
  ["ml", ["milliliters", "millilitres", "milliliter", "millilitre", "ml"]],
  ["l", ["liters", "litres", "liter", "litre", "l"]],
  ["quart", ["quarts", "quart", "qt"]],
  ["pint", ["pints", "pint", "pt"]],
  ["gallon", ["gallons", "gallon", "gal"]],
  ["pinch", ["pinches", "pinch"]],
  ["dash", ["dashes", "dash"]],
  ["clove", ["cloves", "clove"]],
  ["can", ["cans", "can"]],
  ["package", ["packages", "package", "pkg", "pkgs", "packet", "packets"]],
  ["slice", ["slices", "slice"]],
  ["stick", ["sticks", "stick"]],
  ["sprig", ["sprigs", "sprig"]],
  ["bunch", ["bunches", "bunch"]],
  ["head", ["heads", "head"]],
  ["stalk", ["stalks", "stalk"]],
  ["rib", ["ribs", "rib"]],
  ["piece", ["pieces", "piece"]],
  ["jar", ["jars", "jar"]],
  ["bottle", ["bottles", "bottle"]],
  ["bag", ["bags", "bag"]],
  ["box", ["boxes", "box"]],
  ["handful", ["handfuls", "handful"]],
  ["fillet", ["fillets", "fillet"]],
  ["ear", ["ears", "ear"]],
  ["drop", ["drops", "drop"]],
  ["scoop", ["scoops", "scoop"]],
  ["sheet", ["sheets", "sheet"]],
  ["envelope", ["envelopes", "envelope"]],
  ["container", ["containers", "container"]],
  ["loaf", ["loaves", "loaf"]],
];

const UNIT_LOOKUP = new Map();
for (const [canonical, aliases] of UNIT_ALIASES) {
  for (const a of aliases) UNIT_LOOKUP.set(a.toLowerCase(), canonical);
}
export const CANONICAL_UNITS = UNIT_ALIASES.map(([c]) => c);

export function normalizeFractions(s) {
  return String(s ?? "").replace(/[½⅓⅔¼¾⅛⅜⅝⅞⅕⅙]/g, (ch) => ` ${UNICODE_FRACTIONS[ch]} `).replace(/\s+/g, " ").trim();
}

/** "1 1/2" -> 1.5, "3/4" -> 0.75, "2" -> 2, "1.5" -> 1.5, "" -> null */
export function parseQuantity(s) {
  if (s == null) return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const str = normalizeFractions(String(s)).replace(/,/g, ".").trim();
  if (!str) return null;
  const m = str.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  const f = str.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (f) return Number(f[2]) ? Number(f[1]) / Number(f[2]) : null;
  const n = Number(str.match(/^\d*\.?\d+/)?.[0]);
  return Number.isFinite(n) ? n : null;
}

const NUMBER_RE = "(?:\\d+\\s+\\d+\\s*\\/\\s*\\d+|\\d+\\s*\\/\\s*\\d+|\\d*\\.\\d+|\\d+)";
const LEADING_QTY_RE = new RegExp(`^(${NUMBER_RE})(?:\\s*(?:-|–|to|or)\\s*(${NUMBER_RE}))?\\s*`, "i");

export function parseIngredientLine(rawInput) {
  const raw = cleanText(rawInput);
  const result = { raw, quantity: null, unit: "", item: "", note: "" };
  if (!raw) return result;

  let s = normalizeFractions(raw);

  // Pull out parentheticals as notes (innermost first, so "((Note 1))" works):
  // "1 can (15 oz) black beans" -> note "15 oz"
  const notes = [];
  for (let guard = 0; guard < 6 && /\([^()]*\)/.test(s); guard++) {
    s = s.replace(/\(([^()]*)\)/g, (_, inner) => {
      const t = inner.trim();
      if (t && !notes.includes(t)) notes.push(t);
      return " ";
    });
  }
  s = s.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();

  // "1-3/4 cups" (Taste of Home style) is a mixed number, not a range.
  s = s.replace(/^(\d+)-(\d+\s*\/\s*\d+)\b/, "$1 $2");

  // Quantity
  const qm = s.match(LEADING_QTY_RE);
  if (qm) {
    result.quantity = parseQuantity(qm[1]);
    s = s.slice(qm[0].length).trim();
  }

  // Unit (one or two words, e.g. "fl oz")
  const two = s.match(/^([a-zA-Z]+\s[a-zA-Z]+)\b\.?\s*/);
  const one = s.match(/^([a-zA-Z]+)\b\.?\s*/);
  if (two && UNIT_LOOKUP.has(two[1].toLowerCase()) && two[1].toLowerCase().includes(" ")) {
    result.unit = UNIT_LOOKUP.get(two[1].toLowerCase());
    s = s.slice(two[0].length);
  } else if (one) {
    const word = one[1];
    const lower = word.toLowerCase();
    // Single-letter units are only accepted as explicit abbreviations ("2 T butter", "1 t salt", "1 c flour").
    let unit = null;
    if (word === "T") unit = "tbsp";
    else if (word === "t") unit = "tsp";
    else if (lower === "c" || lower === "g" || lower === "l") unit = result.quantity != null ? UNIT_LOOKUP.get(lower) : null;
    else if (UNIT_LOOKUP.has(lower)) unit = UNIT_LOOKUP.get(lower);
    if (unit && result.quantity != null) {
      result.unit = unit;
      s = s.slice(one[0].length);
    } else if (unit && ["pinch", "dash", "handful"].includes(unit)) {
      result.unit = unit;
      s = s.slice(one[0].length);
    }
  }

  // Alternate measurement after the unit: "225g/8oz plain flour", "600 g / 1.2 lb steak"
  const alt = s.match(/^\/\s*(\d[\d./ ]*\s*[a-zA-Z]+\.?)\s+/);
  if (alt) {
    notes.push(`or ${alt[1].trim()}`);
    s = s.slice(alt[0].length).trim();
  }

  s = s.replace(/^of\s+/i, "").trim();

  // Note after the first comma: "onion, diced"
  const comma = s.indexOf(",");
  if (comma > 0) {
    notes.unshift(s.slice(comma + 1).trim());
    s = s.slice(0, comma).trim();
  }
  // Trailing "- optional" / "or to taste"
  const dash = s.match(/\s[-–]\s(.+)$/);
  if (dash) {
    notes.push(dash[1].trim());
    s = s.slice(0, dash.index).trim();
  }

  result.item = s.replace(/\s+/g, " ").trim();
  result.note = notes.filter(Boolean).join("; ");
  if (!result.item) {
    result.item = raw;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Validation / normalization of the recipe shape
// ---------------------------------------------------------------------------

function str(v, max = 500) {
  if (v == null) return "";
  if (typeof v === "object") return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
}

export function normalizeIngredient(ing) {
  if (typeof ing === "string") return parseIngredientLine(ing);
  if (!ing || typeof ing !== "object") return null;
  const raw = str(ing.raw, 300);
  const item = str(ing.item, 200);
  const unit = str(ing.unit, 40).toLowerCase();
  const quantity = parseQuantity(ing.quantity);
  const note = str(ing.note, 300);
  if (!raw && !item) return null;
  return {
    raw: raw || [quantity ?? "", unit, item, note ? `(${note})` : ""].filter((x) => x !== "" && x != null).join(" ").trim(),
    quantity,
    unit: UNIT_LOOKUP.get(unit) ?? unit,
    item: item || parseIngredientLine(raw).item,
    note,
  };
}

/**
 * Validates and normalizes a recipe object. Returns { ok, errors, recipe }.
 * The returned recipe contains exactly RECIPE_FIELDS (unknown keys such as image/video are dropped).
 */
export function validateRecipe(input, { requireIngredients = true } = {}) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: ["Recipe must be an object"], recipe: null };
  }
  const title = str(input.title, 200);
  if (!title) errors.push("Missing title");

  const ingredients = (Array.isArray(input.ingredients) ? input.ingredients : [])
    .map(normalizeIngredient)
    .filter(Boolean);
  if (requireIngredients && ingredients.length === 0) errors.push("No ingredients found");

  const instructions = (Array.isArray(input.instructions) ? input.instructions : typeof input.instructions === "string" ? input.instructions.split(/\n+/) : [])
    .map((s) => str(s, 2000))
    .filter(Boolean);

  const tags = uniqueTags(Array.isArray(input.tags) ? input.tags : typeof input.tags === "string" ? input.tags.split(",") : []);

  let sourceUrl = str(input.sourceUrl, 1000);
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) sourceUrl = "";

  const recipe = {
    title,
    sourceUrl,
    servings: str(input.servings, 60),
    prepTime: str(input.prepTime, 60),
    cookTime: str(input.cookTime, 60),
    ingredients,
    instructions,
    tags,
  };
  return { ok: errors.length === 0, errors, recipe };
}

/** True if any key anywhere in the object looks like an image/media field (used by tests). */
export function containsMediaFields(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return false;
  if (Array.isArray(obj)) return obj.some((o) => containsMediaFields(o, depth + 1));
  for (const [k, v] of Object.entries(obj)) {
    if (/image|thumbnail|photo|video|logo/i.test(k)) return true;
    if (containsMediaFields(v, depth + 1)) return true;
  }
  return false;
}
