// Netlify Blobs access. One site-wide store holds all app data.
import { getStore } from "@netlify/blobs";

export const STORE_NAME = "recipe-app";

export const KEYS = {
  RECIPES_INDEX: "recipes-index",
  WEEK: "week",
  GROCERY_LIST: "grocery-list",
  SETTINGS: "settings",
  KROGER_TOKENS: "kroger-tokens",
  KROGER_CLIENT_TOKEN: "kroger-client-token",
  PREFERENCES: "preferences",
  LOGIN_ATTEMPTS: "login-attempts",
  AI_USAGE: "ai-usage",
  recipe: (id) => `recipes/${id}`,
  job: (id) => `jobs/${id}`,
};

let _store;

export function store() {
  if (!_store) {
    // Strong consistency so a write is visible to the very next read
    // (single user, low traffic - the latency cost is negligible).
    _store = getStore({ name: STORE_NAME, consistency: "strong" });
  }
  return _store;
}

export async function readJSON(key, fallback = null) {
  const value = await store().get(key, { type: "json" });
  return value === null || value === undefined ? fallback : value;
}

export async function writeJSON(key, value) {
  await store().setJSON(key, value);
}

export async function remove(key) {
  await store().delete(key);
}

export async function listKeys(prefix) {
  const { blobs } = await store().list({ prefix });
  return blobs.map((b) => b.key);
}

export const DEFAULT_PANTRY_STAPLES = [
  "salt",
  "kosher salt",
  "black pepper",
  "pepper",
  "olive oil",
  "vegetable oil",
  "canola oil",
  "cooking spray",
  "water",
  "sugar",
  "brown sugar",
  "all-purpose flour",
  "flour",
  "baking soda",
  "baking powder",
  "vanilla extract",
  "garlic powder",
  "onion powder",
  "paprika",
  "ground cumin",
  "red pepper flakes",
  "dried oregano",
  "cinnamon",
  "soy sauce",
  "vinegar",
  "honey",
  "ketchup",
  "mustard",
  "mayonnaise",
];

export async function getSettings() {
  const s = (await readJSON(KEYS.SETTINGS, null)) || {};
  return {
    pantryStaples: Array.isArray(s.pantryStaples) ? s.pantryStaples : DEFAULT_PANTRY_STAPLES,
    locationId: s.locationId || "",
    locationName: s.locationName || "",
  };
}
