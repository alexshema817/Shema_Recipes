// Unit tests for the preference matcher (netlify/lib/preferences.mjs).
// Run: npm run test:prefs
import { singular, termMatchesName, findPreference, buildHintedTerm, validatePreference, applyLearnedPick } from "../netlify/lib/preferences.mjs";

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`ok    ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
  }
}

const pref = (term, extra = {}) => ({ term, source: "manual", updatedAt: "2026-01-01T00:00:00.000Z", ...extra });
const prefs = {
  milk: pref("milk", { product: { upc: "0001111041700", description: "Kroger 2% Milk", brand: "Kroger", size: "1 gal" } }),
  "coconut milk": pref("coconut milk", { product: { upc: "0001111041701", description: "Thai Kitchen Coconut Milk" } }),
  egg: pref("egg", { hint: "Vital Farms large brown" }),
  butter: pref("butter", { hint: "Kerrygold" }),
  "whole milk": pref("whole milk", { product: { upc: "0001111041702", description: "Kroger Whole Milk" } }),
};
const matched = (name) => findPreference(prefs, name)?.preference.term ?? null;

// --- whole-word matching
console.log("\n# whole-word matching");
check("milk matches 'whole milk'", termMatchesName("milk", "whole milk"), true);
check("milk matches '2% milk'", termMatchesName("milk", "2% milk"), true);
check("milk does NOT match 'buttermilk'", termMatchesName("milk", "buttermilk"), false);
check("milk does NOT match 'milky way bars'", termMatchesName("milk", "milky way bars"), false);
check("coconut milk matches 'light coconut milk'", termMatchesName("coconut milk", "light coconut milk"), true);
check("coconut milk needs the words in order", termMatchesName("coconut milk", "milk coconut"), false);
check("butter does NOT match 'buttermilk'", matched("buttermilk"), null);
check("butter does NOT match 'peanut butter'? (it does - whole word)", matched("peanut butter"), "butter");

// --- specificity
console.log("\n# most specific wins");
check("'light coconut milk' -> coconut milk (2 words beat 1)", matched("light coconut milk"), "coconut milk");
check("'coconut milk' exact -> coconut milk", findPreference(prefs, "Coconut Milk"), { preference: prefs["coconut milk"], exact: true });
check("'organic whole milk' -> whole milk, not milk", matched("organic whole milk"), "whole milk");
check("'2% milk' -> milk", matched("2% milk"), "milk");
check("'milk' exact match", findPreference(prefs, "milk"), { preference: prefs.milk, exact: true });
check("exact beats a longer non-exact candidate", findPreference({ ...prefs, "milk chocolate": pref("milk chocolate", { hint: "x" }) }, "milk")?.preference.term, "milk");

// --- plurals
console.log("\n# plurals");
check("singular(eggs)", singular("eggs"), "egg");
check("singular(tomatoes)", singular("tomatoes"), "tomato");
check("singular(berries)", singular("berries"), "berry");
check("singular(milk) unchanged", singular("milk"), "milk");
check("'eggs' -> egg", matched("eggs"), "egg");
check("'large eggs' -> egg", matched("large eggs"), "egg");
check("term 'tomatoes' matches 'roma tomato'", termMatchesName("tomatoes", "roma tomato"), true);
check("term 'berry' matches 'mixed berries'", termMatchesName("berry", "mixed berries"), true);

// --- no match
console.log("\n# no match");
check("'chicken thighs' -> null", matched("chicken thighs"), null);
check("'buttermilk' -> null", matched("buttermilk"), null);
check("empty name -> null", findPreference(prefs, ""), null);
check("empty prefs -> null", findPreference({}, "milk"), null);

// --- hinted search term
console.log("\n# hinted search term");
check("hint appended after item words", buildHintedTerm("eggs", "Vital Farms large brown"), "eggs vital farms large brown");
check("hint words already present are not repeated", buildHintedTerm("Kerrygold butter", "Kerrygold"), "kerrygold butter");
check("8-word cap keeps the item's own words", buildHintedTerm("one two three four five six seven", "alpha beta"), "one two three four five six seven alpha");
check("item with 8+ words drops the hint entirely", buildHintedTerm("a1 a2 a3 a4 a5 a6 a7 a8 a9", "brand"), "a1 a2 a3 a4 a5 a6 a7 a8");

// --- validation
console.log("\n# validation");
check("term too short", validatePreference({ term: "x", hint: "y" }).ok, false);
check("needs hint or product", validatePreference({ term: "milk" }).ok, false);
check("hint too long", validatePreference({ term: "milk", hint: "x".repeat(81) }).ok, false);
check("product needs a UPC", validatePreference({ term: "milk", product: { description: "no upc" } }).ok, false);
{
  const v = validatePreference({ term: "  Coconut  Milk! ", hint: "  Thai   Kitchen ", product: { upc: "0001111041701", description: "d".repeat(200), brand: "b", size: "s", price: "3.499", productId: "0001111041701" } });
  check("valid upsert is normalized and limited", v.ok && { term: v.preference.term, hint: v.preference.hint, desc: v.preference.product.description.length, price: v.preference.product.price, source: v.preference.source }, { term: "coconut milk", hint: "Thai Kitchen", desc: 160, price: 3.5, source: "manual" });
}

// --- learning picks
console.log("\n# learned picks");
{
  const store = { milk: pref("milk", { product: { upc: "0001111041700", description: "Kroger 2% Milk" } }), butter: pref("butter", { hint: "Kerrygold" }) };
  applyLearnedPick(store, { name: "Milk", upc: "0009999999999", description: "Other Milk" }, "2026-02-02T00:00:00.000Z");
  check("manual pinned product is not overwritten", store.milk.product.upc, "0001111041700");
  applyLearnedPick(store, { name: "butter", upc: "0008888888888", description: "Kerrygold Butter", brand: "Kerrygold", size: "8 oz" }, "2026-02-02T00:00:00.000Z");
  check("manual hint-only preference gains the picked product and keeps its hint", { upc: store.butter.product.upc, hint: store.butter.hint, source: store.butter.source }, { upc: "0008888888888", hint: "Kerrygold", source: "manual" });
  applyLearnedPick(store, { name: "Chicken thighs", upc: "0007777777777", description: "Chicken Thighs", productId: "0007777777777", price: 5 }, "2026-02-02T00:00:00.000Z");
  check("new pick is learned under the normalized name without a price", store["chicken thighs"], { term: "chicken thighs", product: { upc: "0007777777777", description: "Chicken Thighs", brand: "", size: "", productId: "0007777777777" }, source: "learned", updatedAt: "2026-02-02T00:00:00.000Z" });
  applyLearnedPick(store, { name: "chicken thighs", upc: "0006666666666", description: "Different Thighs" }, "2026-03-03T00:00:00.000Z");
  check("learned pick is replaced by a newer pick", store["chicken thighs"].product.upc, "0006666666666");
  applyLearnedPick(store, { name: "bad", upc: "123" }, "2026-03-03T00:00:00.000Z");
  check("invalid UPC is ignored", "bad" in store, false);
  applyLearnedPick(store, { name: "Whole milk", upc: "0001111041700", description: "Kroger 2% Milk" }, "2026-03-03T00:00:00.000Z");
  check("pick that matches the general preference's product is not copied", "whole milk" in store, false);
  applyLearnedPick(store, { name: "Whole milk", upc: "0005555555555", description: "Other Whole Milk" }, "2026-03-03T00:00:00.000Z");
  check("pick that differs from the general preference is learned", store["whole milk"]?.product.upc, "0005555555555");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
