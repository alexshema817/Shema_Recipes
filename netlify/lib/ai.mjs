// Anthropic API calls. Default model: claude-sonnet-5-5 (override with ANTHROPIC_MODEL).
// No `thinking` param (adaptive by default); depth is controlled with output_config.effort.
import Anthropic from "@anthropic-ai/sdk";
import { validateRecipe, parseQuantity } from "./recipe-parser.mjs";

export const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

export const STORE_SECTIONS = [
  "Produce",
  "Meat & Seafood",
  "Dairy & Eggs",
  "Bakery",
  "Deli",
  "Pantry",
  "Spices & Baking",
  "Frozen",
  "Beverages",
  "Other",
];

let _client;
function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  if (!_client) {
    _client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: 10 * 60 * 1000, // ms - background functions allow up to 15 minutes
      maxRetries: 2,
    });
  }
  return _client;
}

/** Strips code fences / surrounding prose and parses JSON. Throws on failure. */
export function parseStrictJSON(text) {
  let s = String(text ?? "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  try {
    return JSON.parse(s);
  } catch {}
  const first = s.search(/[[{]/);
  const last = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(s.slice(first, last + 1));
    } catch {}
  }
  throw new Error("The model did not return valid JSON");
}

async function callJSON({ system, user, schema, effort = "low", maxTokens = 16000 }) {
  const base = {
    model: MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort, format: { type: "json_schema", schema } },
  };
  let res;
  try {
    // Server-side refusal fallback: if the safety classifier declines, the API
    // re-runs the request on a fallback model inside the same call.
    res = await client().beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
      res = await client().messages.create(base);
    } else {
      throw err;
    }
  }
  if (res.stop_reason === "refusal") {
    const why = res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : "";
    throw new Error(`The model declined this request${why}`);
  }
  if (res.stop_reason === "max_tokens") {
    throw new Error("The model's output was cut off. Try a shorter input.");
  }
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  return parseStrictJSON(text);
}

// ---------------------------------------------------------------------------
// Recipe extraction
// ---------------------------------------------------------------------------

const RECIPE_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    sourceUrl: { type: "string" },
    servings: { type: "string" },
    prepTime: { type: "string" },
    cookTime: { type: "string" },
    ingredients: {
      type: "array",
      items: {
        type: "object",
        properties: {
          raw: { type: "string" },
          quantity: { type: "string" },
          unit: { type: "string" },
          item: { type: "string" },
          note: { type: "string" },
        },
        required: ["raw", "quantity", "unit", "item", "note"],
        additionalProperties: false,
      },
    },
    instructions: { type: "array", items: { type: "string" } },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["title", "sourceUrl", "servings", "prepTime", "cookTime", "ingredients", "instructions", "tags"],
  additionalProperties: false,
};

const RECIPE_SYSTEM = `You extract a recipe from messy webpage text or pasted text and return it as JSON only.
Ignore life stories, ads, comments, navigation, related links and filler - keep only the recipe.
Rules:
- title: the recipe name.
- sourceUrl: the source URL given, or "" if none.
- servings: e.g. "4" or "4-6 servings"; "" if unknown. prepTime/cookTime: e.g. "15 min", "1 hr 20 min"; "" if unknown.
- ingredients: one entry per ingredient line. raw = the original line verbatim. quantity = a decimal string ("0.5", "1.5", "2") or "" if none. unit = a short canonical unit (cup, tbsp, tsp, oz, lb, g, kg, ml, l, clove, can, package, slice, pinch ...) or "". item = the ingredient name without quantity, unit or prep notes. note = prep notes such as "diced", "softened", "optional", or "".
- instructions: one step per element, in order, without step numbers.
- tags: 3 to 8 short lowercase tags (course, cuisine, main ingredient, diet, method).
- If the text contains no recipe at all, return title "" with empty arrays.`;

export async function extractRecipeWithAI(text, sourceUrl = "") {
  const user = `Source URL: ${sourceUrl || "(none)"}\n\nText:\n"""\n${String(text).slice(0, 40000)}\n"""`;
  const data = await callJSON({ system: RECIPE_SYSTEM, user, schema: RECIPE_SCHEMA, effort: "low" });
  if (!data.sourceUrl && sourceUrl) data.sourceUrl = sourceUrl;
  const { ok, errors, recipe } = validateRecipe(data);
  if (!ok) throw new Error(`Could not find a recipe in that text (${errors.join("; ")})`);
  return recipe;
}

// ---------------------------------------------------------------------------
// Grocery list consolidation
// ---------------------------------------------------------------------------

const GROCERY_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          quantity: { type: "string" },
          unit: { type: "string" },
          section: { type: "string", enum: STORE_SECTIONS },
          fromRecipes: { type: "array", items: { type: "string" } },
          checked: { type: "boolean" },
        },
        required: ["id", "name", "quantity", "unit", "section", "fromRecipes", "checked"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const GROCERY_SYSTEM = `You turn the ingredients of several recipes (already scaled to the servings wanted) into one consolidated grocery list, returned as JSON only.
Rules:
- Merge the same ingredient across recipes even when worded differently ("yellow onion" / "onions" / "onion, diced" are one item).
- Add quantities when units are compatible and express the total in the most sensible single unit (e.g. 2 tbsp + 1/4 cup butter = 6 tbsp; 8 oz + 1 lb = 1.5 lb). Volume: tsp/tbsp/cup/fl oz/ml/l. Weight: oz/lb/g/kg. Count: whole items.
- Keep incompatible units for the same ingredient as separate lines (e.g. "1 cup rice" and "1 bag rice").
- Round to practical shopping amounts; quantity is a decimal string ("1.5") or "" when it does not apply.
- Exclude the pantry staples listed (and obvious equivalents like "kosher salt" for "salt").
- section: pick the best store section from the allowed list.
- fromRecipes: titles of the recipes that use the item. id: a short unique slug. checked: always false.
- name: a plain shopping name (no prep notes like "diced").`;

export async function consolidateGroceryList(recipes, pantryStaples = []) {
  const payload = {
    allowedSections: STORE_SECTIONS,
    pantryStaples,
    recipes: recipes.map((r) => ({
      title: r.title,
      servingsMultiplier: r.multiplier,
      ingredients: r.ingredients.map((i) => ({ quantity: i.quantity ?? "", unit: i.unit || "", item: i.item, note: i.note || "" })),
    })),
  };
  const data = await callJSON({
    system: GROCERY_SYSTEM,
    user: JSON.stringify(payload),
    schema: GROCERY_SCHEMA,
    effort: "medium",
  });
  const items = Array.isArray(data?.items) ? data.items : null;
  if (!items) throw new Error("The model did not return a grocery list");
  const seen = new Set();
  return items
    .filter((it) => it && typeof it.name === "string" && it.name.trim())
    .map((it) => {
      let id = String(it.id || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
      while (seen.has(id)) id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
      seen.add(id);
      return {
        id,
        name: it.name.trim(),
        quantity: parseQuantity(it.quantity),
        unit: String(it.unit || "").trim(),
        section: STORE_SECTIONS.includes(it.section) ? it.section : "Other",
        fromRecipes: Array.isArray(it.fromRecipes) ? it.fromRecipes.map(String) : [],
        checked: false,
      };
    });
}
