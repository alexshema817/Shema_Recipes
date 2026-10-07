// Tests the JSON-LD recipe parser (the same module the parse function uses)
// against real recipe sites. Run: npm run test:jsonld [url ...]
import {
  fetchPage,
  extractJsonLdBlocks,
  findRecipeNodes,
  extractRecipeFromHtml,
  validateRecipe,
  containsMediaFields,
  reduceHtmlToText,
} from "../netlify/lib/recipe-parser.mjs";

// Sites behind aggressive bot protection (allrecipes, seriouseats, budgetbytes ...)
// may answer 403 to server-side fetches; the app then tells the user to paste the text.
const DEFAULT_URLS = [
  "https://www.bbcgoodfood.com/recipes/classic-lasagne",
  "https://www.kingarthurbaking.com/recipes/classic-sandwich-bread-recipe",
  "https://www.loveandlemons.com/banana-bread/",
  "https://www.food.com/recipe/best-banana-bread-2886",
  "https://www.allrecipes.com/recipe/23600/worlds-best-lasagna/",
];

const urls = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_URLS;
let passed = 0;

for (const url of urls) {
  console.log(`\n=== ${url}`);
  try {
    const { html, finalUrl } = await fetchPage(url);
    const blocks = extractJsonLdBlocks(html);
    const nodes = findRecipeNodes(blocks);
    console.log(`JSON-LD blocks: ${blocks.length}, Recipe nodes: ${nodes.length}`);
    const recipe = extractRecipeFromHtml(html, finalUrl);
    if (!recipe) {
      console.log("No Recipe JSON-LD found -> would fall back to AI. Reduced text length:", reduceHtmlToText(html).length);
      continue;
    }
    const { ok, errors, recipe: clean } = validateRecipe(recipe);
    const rawHadImage = nodes.some((n) => "image" in n || "thumbnailUrl" in n || "video" in n);
    console.log(`title:        ${clean.title}`);
    console.log(`servings:     ${clean.servings || "-"}   prep: ${clean.prepTime || "-"}   cook: ${clean.cookTime || "-"}`);
    console.log(`ingredients:  ${clean.ingredients.length}`);
    console.log(`steps:        ${clean.instructions.length}`);
    console.log(`tags:         ${clean.tags.join(", ") || "-"}`);
    console.log(`sample ingredient: ${JSON.stringify(clean.ingredients[0])}`);
    console.log(`first step:   ${clean.instructions[0]?.slice(0, 110) || "-"}`);
    console.log(`source node had image/video fields: ${rawHadImage}; output contains media fields: ${containsMediaFields(clean)}`);
    console.log(`output keys:  ${Object.keys(clean).join(", ")}`);
    console.log(`valid:        ${ok}${errors.length ? " (" + errors.join("; ") + ")" : ""}`);
    if (ok && clean.ingredients.length && clean.instructions.length && !containsMediaFields(clean)) passed++;
  } catch (err) {
    console.log(`FAILED: ${err.message}`);
  }
}

console.log(`\n${passed}/${urls.length} sites parsed via JSON-LD with ingredients + steps and no media fields.`);
process.exit(passed >= 2 ? 0 : 1);
