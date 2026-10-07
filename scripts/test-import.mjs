// Unit tests for the browser importer: the generated bookmarklet / Shortcut script,
// the #import= payload codec, the importer running against a fake DOM, and the
// server-side decision logic behind /api/parse-import (no network, no Blobs).
// Run: npm run test:import
import { decideImport, sanitizeImportBody, MAX_IMPORT_CHARS, NO_RECIPE_MESSAGE } from "../netlify/lib/import.mjs";
import { containsMediaFields } from "../netlify/lib/recipe-parser.mjs";
import { importer, importerSource, buildBookmarklet, buildShortcutScript, encodeImportPayload, decodeImportPayload, APP_ORIGIN, IMPORT_HASH_PREFIX, MAX_JSONLD_CHARS, MAX_TEXT_CHARS } from "../public/js/importer.js";

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

// ---------------------------------------------------------------------------
// Sample JSON-LD (as the importer would collect it: raw script text)
// ---------------------------------------------------------------------------

const PAGE_URL = "https://www.allrecipes.com/recipe/23600/worlds-best-lasagna/";

const GRAPH_BLOCK = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "WebSite", name: "Example Food", url: "https://example.com/" },
    {
      "@type": ["Recipe", "NewsArticle"],
      name: "World's Best Lasagna",
      image: { "@type": "ImageObject", url: "https://example.com/lasagna.jpg", width: 1200 },
      thumbnailUrl: "https://example.com/thumb.jpg",
      video: { "@type": "VideoObject", name: "How to", thumbnailUrl: "https://example.com/v.jpg" },
      author: { "@type": "Person", name: "Someone", image: "https://example.com/a.jpg" },
      recipeYield: ["12", "12 servings"],
      prepTime: "PT30M",
      cookTime: "PT2H30M",
      recipeIngredient: ["1 pound sweet Italian sausage", "½ cup chopped onion", "2 (6 ounce) cans tomato paste", "1 ½ teaspoons salt"],
      recipeInstructions: [
        { "@type": "HowToSection", name: "Sauce", itemListElement: [{ "@type": "HowToStep", text: "Cook sausage and onion until browned." }, { "@type": "HowToStep", text: "Stir in tomato paste and simmer 1½ hours." }] },
        { "@type": "HowToSection", name: "Assemble", itemListElement: [{ "@type": "HowToStep", text: "Layer noodles, cheese and sauce; bake 25 minutes." }] },
      ],
      keywords: "lasagna, italian, dinner",
      recipeCategory: ["Main Dish"],
      mainEntityOfPage: { "@type": "WebPage", "@id": "https://example.com/some-other-canonical" },
    },
  ],
});

const NON_RECIPE_BLOCK = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] });

const LONG_TEXT = ["Weeknight Chicken Soup", "Ingredients", "1 whole chicken (about 4 pounds)", "2 carrots, sliced", "2 celery ribs, sliced", "1 onion, chopped", "8 cups water", "Salt and pepper", "Instructions", "Put everything in a pot and simmer for 90 minutes, skimming the surface now and then.", "Remove the chicken, shred the meat, discard the bones and return the meat to the pot.", "Season and serve hot."].join("\n");

// ---------------------------------------------------------------------------

console.log("# decideImport: Recipe in @graph with HowToSection, images stripped");
{
  const res = decideImport({ url: PAGE_URL, title: "World's Best Lasagna | Allrecipes", jsonld: [NON_RECIPE_BLOCK, GRAPH_BLOCK], text: "" });
  check("status done / jsonld", [res.status, res.method], ["done", "jsonld"]);
  check("title", res.recipe?.title, "World's Best Lasagna");
  check("sourceUrl is the page URL, not the node's mainEntityOfPage", res.recipe?.sourceUrl, PAGE_URL);
  check("servings picks the descriptive yield", res.recipe?.servings, "12 servings");
  check("prep / cook", [res.recipe?.prepTime, res.recipe?.cookTime], ["30 min", "2 hr 30 min"]);
  check("4 ingredients", res.recipe?.ingredients.length, 4);
  check("½ cup parsed", [res.recipe?.ingredients[1].quantity, res.recipe?.ingredients[1].unit, res.recipe?.ingredients[1].item], [0.5, "cup", "chopped onion"]);
  check("HowToSection steps flattened", res.recipe?.instructions, ["Cook sausage and onion until browned.", "Stir in tomato paste and simmer 1½ hours.", "Layer noodles, cheese and sauce; bake 25 minutes."]);
  check("tags", res.recipe?.tags, ["lasagna", "italian", "dinner", "main dish"]);
  check("no image/video/thumbnail fields in output", containsMediaFields(res.recipe), false);
  check("output keys are exactly the recipe fields", Object.keys(res.recipe || {}), ["title", "sourceUrl", "servings", "prepTime", "cookTime", "ingredients", "instructions", "tags"]);
}

console.log("\n# decideImport: HTML-comment wrapped block, non-http url");
{
  const res = decideImport({ url: "javascript:alert(1)", title: "", jsonld: [`<!--${GRAPH_BLOCK}-->`], text: "" });
  check("still parsed", res.status, "done");
  check("non-http url becomes empty sourceUrl", res.recipe?.sourceUrl, "");
}

console.log("\n# decideImport: no Recipe + long text -> AI job path");
{
  const res = decideImport({ url: PAGE_URL, title: "Weeknight Chicken Soup - Example", jsonld: [NON_RECIPE_BLOCK], text: LONG_TEXT });
  check("status needs_ai", res.status, "needs_ai");
  check("payload sourceUrl", res.payload?.sourceUrl, PAGE_URL);
  check("payload text keeps the page text", res.payload?.text.includes("8 cups water"), true);
  check("title is prepended when the text does not already contain it", res.payload?.text.startsWith("Weeknight Chicken Soup - Example\n\n"), true);
  const same = decideImport({ url: PAGE_URL, title: "Weeknight Chicken Soup", jsonld: [], text: LONG_TEXT });
  check("title is not duplicated when the text already starts with it", same.payload?.text.startsWith("Weeknight Chicken Soup\nIngredients"), true);
}

console.log("\n# decideImport: no Recipe + short text -> error");
{
  const res = decideImport({ url: PAGE_URL, title: "x", jsonld: [], text: "Just a short page. Nothing to see here." });
  check("status error 422", [res.status, res.httpStatus], ["error", 422]);
  check("message", res.error, NO_RECIPE_MESSAGE);
  const broken = decideImport({ url: PAGE_URL, title: "x", jsonld: ["{not json at all", 42, null], text: "" });
  check("unparseable / non-string blocks are ignored", [broken.status, broken.httpStatus], ["error", 422]);
}

console.log("\n# decideImport: oversized / malformed bodies are rejected");
{
  const big = decideImport({ url: PAGE_URL, title: "", jsonld: [GRAPH_BLOCK], text: "x".repeat(MAX_IMPORT_CHARS) });
  check("over the total cap -> 413", [big.status, big.httpStatus], ["error", 413]);
  check("oversized message mentions the limit", String(big.error).includes(String(MAX_IMPORT_CHARS)), true);
  check("array body -> 400", decideImport([1, 2]).httpStatus, 400);
  check("null body -> 400", decideImport(null).httpStatus, 400);
  const s = sanitizeImportBody({ url: " https://example.com/r ", title: "  a\n b ", jsonld: ["a", "", "  ", 3], text: "  t  " });
  check("sanitize coerces fields", s, { url: "https://example.com/r", title: "a b", jsonld: ["a"], text: "t" });
  check("jsonld capped at 20 blocks", sanitizeImportBody({ jsonld: Array(30).fill("{}") }).jsonld.length, 20);
}

console.log("\n# importer source, bookmarklet, Shortcut script");
{
  const bm = buildBookmarklet();
  check("bookmarklet starts with javascript:", bm.startsWith("javascript:"), true);
  check("bookmarklet is one line", /[\r\n]/.test(bm), false);
  check("bookmarklet has no raw # (would start a URL fragment)", bm.includes("#"), false);
  check("bookmarklet navigates with location.href", bm.includes("location.href=u"), true);
  check("bookmarklet does not use window.open", bm.includes("window.open"), false);
  check("bookmarklet embeds the app origin", bm.includes(APP_ORIGIN), true);
  check("percent-decoding restores the #import= hash", decodeURIComponent(bm).includes(`/${IMPORT_HASH_PREFIX}`), true);
  check("bookmarklet decodes to syntactically valid JS", (() => { try { new Function(decodeURIComponent(bm.slice("javascript:".length))); return true; } catch (e) { return e.message; } })(), true);
  const sc = buildShortcutScript();
  check("Shortcut script contains completion(", sc.includes("completion("), true);
  check("Shortcut script does not navigate", sc.includes("location.href="), false);
  check("Shortcut script is valid JS once completion exists", (() => { try { new Function("completion", sc); return true; } catch (e) { return e.message; } })(), true);
  check("importerSource has no line comments", /\/\/ /.test(importerSource()), false);
  console.log(`      bookmarklet length: ${bm.length} chars, Shortcut script: ${sc.length} chars`);
}

console.log("\n# payload codec round-trips non-ASCII");
{
  const payload = { v: 1, url: "https://example.com/r?q=crème", title: "Crème brûlée ½ ™ – 😀", jsonld: ["{\"name\":\"é ½ ™\"}"], text: "½ cup crème fraîche ™ é" };
  const enc = encodeImportPayload(payload);
  check("encoding is base64url (no + / =)", /^[A-Za-z0-9_-]+$/.test(enc), true);
  check("round trip", decodeImportPayload(enc), payload);
  check("decoder tolerates padding", decodeImportPayload(enc + "=="), payload);
  check("decoder rejects garbage", (() => { try { decodeImportPayload("%%%not-base64%%%"); return "no throw"; } catch { return "threw"; } })(), "threw");
  check("decoder rejects non-object JSON", (() => { try { decodeImportPayload(encodeImportPayload([1])); return "no throw"; } catch { return "threw"; } })(), "threw");
  check("decoder drops non-string jsonld entries", decodeImportPayload(encodeImportPayload({ v: 1, jsonld: ["a", 1, null] })).jsonld, ["a"]);
}

console.log("\n# importer against a fake DOM");
{
  const fakeDom = ({ scripts, text, articleText }) => {
    globalThis.document = {
      title: "Fake Recipe Page – Example",
      body: { innerText: text },
      querySelectorAll: (sel) => (sel.includes("ld+json") ? scripts.map((s) => ({ textContent: s })) : []),
      querySelector: (sel) => (sel === "article" && articleText ? { innerText: articleText } : null),
    };
    globalThis.location = { href: PAGE_URL };
    globalThis.alert = (m) => { throw new Error(`alert: ${m}`); };
  };
  const run = () => new Promise((resolve) => importer(resolve, APP_ORIGIN, MAX_JSONLD_CHARS, MAX_TEXT_CHARS));
  const decodeUrl = (u) => decodeImportPayload(u.slice((APP_ORIGIN + "/" + IMPORT_HASH_PREFIX).length));

  fakeDom({ scripts: [NON_RECIPE_BLOCK, GRAPH_BLOCK, "x".repeat(MAX_JSONLD_CHARS)], text: "body text" });
  const url1 = await run();
  check("opens the app import URL", url1.startsWith(`${APP_ORIGIN}/${IMPORT_HASH_PREFIX}`), true);
  const p1 = decodeUrl(url1);
  check("only Recipe-mentioning blocks are collected, oversized skipped", p1.jsonld, [GRAPH_BLOCK]);
  check("no text when JSON-LD was found", p1.text, "");
  check("url + title + v", [p1.v, p1.url, p1.title], [1, PAGE_URL, "Fake Recipe Page – Example"]);
  check("server accepts what the importer produced", decideImport(p1).status, "done");

  const article = "Title\n\n  Ingredients  \n\n\n 1 cup   flour \t  sifted \n".repeat(20) + "é½™";
  fakeDom({ scripts: [NON_RECIPE_BLOCK], text: "short body", articleText: article });
  const p2 = decodeUrl(await run());
  check("falls back to article text when no Recipe JSON-LD", p2.jsonld, []);
  check("whitespace collapsed, newlines kept", p2.text.startsWith("Title\nIngredients\n1 cup flour sifted\nTitle"), true);
  check("non-ASCII survives", p2.text.endsWith("é½™"), true);

  fakeDom({ scripts: [], text: "a".repeat(MAX_TEXT_CHARS + 5000), articleText: "tiny" });
  const p3 = decodeUrl(await run());
  check("short article ignored, body used and capped", p3.text.length, MAX_TEXT_CHARS);

  delete globalThis.document;
  delete globalThis.location;
  delete globalThis.alert;
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
