// Recipe Library: search, add (URL / text / share), review-before-save, detail, edit, delete, This Week toggle.
import { api, startBackground, pollJob } from "../api.js";
import { h, svgIcon, ICONS, toast, openDialog, confirmDialog, showBusy, fmtQty, qtyText, debounce } from "../util.js";

let cache = { recipes: null, weekIds: new Set() };

async function loadIndex(force = false) {
  if (!cache.recipes || force) {
    const [{ recipes }, week] = await Promise.all([api("/api/recipes"), api("/api/week")]);
    cache.recipes = recipes;
    cache.weekIds = new Set(week.items.map((w) => w.id));
  }
  return cache.recipes;
}

export function invalidate() {
  cache.recipes = null;
}

export async function render(container, ctx) {
  if (ctx.params[0] === "recipe" && ctx.params[1]) return renderDetail(container, ctx, ctx.params[1]);
  return renderList(container, ctx);
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

async function renderList(container, ctx) {
  ctx.setActions(h("button", { class: "btn primary small", onclick: () => openAddDialog(ctx) }, svgIcon(ICONS.plus, 18), "Add"));
  const recipes = await loadIndex();
  if (!ctx.isCurrent()) return;

  const list = h("div", { class: "stack" });
  const searchInput = h("input", { type: "search", placeholder: "Search title, ingredient or tag", autocomplete: "off" });
  const search = h("div", { class: "search" }, svgIcon(ICONS.search), searchInput);

  const draw = () => {
    const q = searchInput.value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const matches = recipes.filter((r) => {
      if (!terms.length) return true;
      const hay = [r.title, ...(r.tags || []), ...(r.ingredients || [])].join(" \n ").toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    list.replaceChildren();
    if (!recipes.length) {
      list.append(
        h("div", { class: "empty" }, h("p", {}, "No recipes yet."), h("p", { class: "small" }, "Add one from a URL, paste the text, or share a link to this app from your phone."), h("button", { class: "btn primary", onclick: () => openAddDialog(ctx) }, "Add your first recipe")),
      );
      return;
    }
    if (!matches.length) {
      list.append(h("div", { class: "empty" }, "Nothing matches that search."));
      return;
    }
    for (const r of matches) list.append(recipeCard(r, ctx));
  };
  searchInput.addEventListener("input", debounce(draw, 120));

  container.append(search, h("p", { class: "muted small", style: { margin: "8px 0 0" } }, `${recipes.length} recipe${recipes.length === 1 ? "" : "s"}`), list);
  draw();

  const shared = ctx.takePendingShare();
  if (shared) openAddDialog(ctx, shared);
}

function recipeCard(r, ctx) {
  const flagged = cache.weekIds.has(r.id);
  const star = h(
    "button",
    {
      class: `btn icon star ${flagged ? "active" : ""}`,
      title: flagged ? "Remove from This Week" : "Add to This Week",
      "aria-label": "Toggle This Week",
      onclick: async (e) => {
        e.stopPropagation();
        await toggleWeek(r.id, star);
      },
    },
    svgIcon(ICONS.star),
  );
  const card = h(
    "div",
    { class: "card clickable", onclick: () => ctx.navigate(`recipe/${r.id}`) },
    h(
      "div",
      { class: "row between" },
      h("div", { class: "grow" }, h("p", { class: "card-title" }, r.title), h("div", { class: "card-sub" }, `${(r.ingredients || []).length} ingredients${r.servings ? ` · ${r.servings}` : ""}${r.source === "jsonld" ? " · from site data" : r.source === "ai" ? " · AI parsed" : ""}`)),
      star,
    ),
    r.tags?.length ? h("div", { class: "chips" }, r.tags.slice(0, 6).map((t) => h("span", { class: "chip" }, t))) : null,
  );
  return card;
}

async function toggleWeek(id, button) {
  try {
    const res = await api("/api/week/toggle", { method: "POST", body: { id } });
    cache.weekIds = new Set(res.items.map((w) => w.id));
    if (button) button.classList.toggle("active", res.flagged);
    toast(res.flagged ? "Added to This Week" : "Removed from This Week");
    return res.flagged;
  } catch (err) {
    toast(err.message, "error");
  }
}

// ---------------------------------------------------------------------------
// Add recipe: URL / paste text -> parse -> review editor
// ---------------------------------------------------------------------------

export function openAddDialog(ctx, prefill = {}) {
  if (prefill.url) {
    // Shared from the phone: parse immediately, no dialog needed.
    parseAndReview(ctx, { url: prefill.url });
    return;
  }
  let mode = prefill.text ? "text" : "url";
  const urlInput = h("input", { type: "url", placeholder: "https://example.com/best-lasagna", value: prefill.url || "", inputmode: "url", autocomplete: "off" });
  const textInput = h("textarea", { placeholder: "Paste the recipe text here - title, ingredients, instructions. The life story is ignored.", rows: 10 }, prefill.text || "");
  const sourceInput = h("input", { type: "url", placeholder: "Optional source URL", autocomplete: "off" });
  const panels = {
    url: h("div", {}, h("label", {}, "Recipe URL", urlInput), h("p", { class: "muted small" }, "Sites with structured recipe data are read directly. Others are reduced to text and parsed with AI (takes 10-60 seconds).")),
    text: h("div", {}, h("label", {}, "Recipe text", textInput), h("label", {}, "Source", sourceInput)),
  };
  const seg = h("div", { class: "segmented" });
  const body = h("div", {});
  const show = (m) => {
    mode = m;
    seg.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === m));
    body.replaceChildren(seg, panels[m]);
    (m === "url" ? urlInput : textInput).focus();
  };
  seg.append(
    h("button", { type: "button", dataset: { mode: "url" }, onclick: () => show("url") }, "From URL"),
    h("button", { type: "button", dataset: { mode: "text" }, onclick: () => show("text") }, "Paste text"),
  );
  show(mode);

  openDialog({
    title: "Add recipe",
    body,
    actions: [
      { label: "Cancel", onClick: (close) => close() },
      {
        label: "Parse",
        class: "primary",
        onClick: async (close) => {
          const payload = mode === "url" ? { url: urlInput.value.trim() } : { text: textInput.value.trim(), sourceUrl: sourceInput.value.trim() };
          if (mode === "url" && !payload.url) return toast("Enter a URL", "error");
          if (mode === "text" && payload.text.length < 20) return toast("Paste more text first", "error");
          close();
          await parseAndReview(ctx, payload);
        },
      },
    ],
  });
}

async function parseAndReview(ctx, payload) {
  const busy = showBusy(payload.url ? "Fetching the page..." : "Reading your text...");
  try {
    const res = await api("/api/parse", { method: "POST", body: payload });
    let recipe;
    let method = res.method;
    if (res.status === "done") {
      recipe = res.recipe;
    } else if (res.status === "needs_ai") {
      busy.update("Extracting the recipe with AI... this can take up to a minute.");
      await startBackground("/api/parse-background", { jobId: res.jobId, ...res.payload });
      const result = await pollJob(res.jobId, {
        onTick: (_job, elapsed) => busy.update(`Extracting the recipe with AI... ${Math.round(elapsed / 1000)}s`),
      });
      recipe = result.recipe;
      method = "ai";
    } else {
      throw new Error("Unexpected response from the parser");
    }
    busy.close();
    openRecipeEditor(ctx, { recipe, source: method, isNew: true });
  } catch (err) {
    busy.close();
    openDialog({
      title: "Could not parse that",
      body: h("div", {}, h("p", { class: "error" }, err.message), h("p", { class: "muted small" }, "Tip: open the page in your browser, copy the recipe text and use \"Paste text\" instead.")),
      actions: [{ label: "OK", class: "primary", onClick: (close) => close() }],
    });
  }
}

// ---------------------------------------------------------------------------
// Editor (review before save, and edit)
// ---------------------------------------------------------------------------

function ingredientRow(ing = {}) {
  const row = h(
    "div",
    { class: "ing-row" },
    h("input", { type: "text", placeholder: "Qty", value: ing.quantity != null ? fmtQty(ing.quantity) : "", dataset: { f: "quantity" }, inputmode: "decimal" }),
    h("input", { type: "text", placeholder: "Unit", value: ing.unit || "", dataset: { f: "unit" } }),
    h("input", { type: "text", placeholder: "Ingredient", value: ing.item || "", dataset: { f: "item" } }),
    h("button", { type: "button", class: "btn ghost icon small", "aria-label": "Remove", onclick: () => row.remove() }, svgIcon(ICONS.trash, 18)),
    h("input", { type: "text", class: "note", placeholder: "Note (diced, optional...)", value: ing.note || "", dataset: { f: "note" } }),
  );
  row.dataset.raw = ing.raw || "";
  return row;
}

function readIngredients(host) {
  return [...host.querySelectorAll(".ing-row")]
    .map((row) => {
      const get = (f) => row.querySelector(`[data-f="${f}"]`).value.trim();
      const item = get("item");
      const quantity = get("quantity");
      const unit = get("unit");
      const note = get("note");
      if (!item) return null;
      const raw = row.dataset.raw && row.dataset.raw.toLowerCase().includes(item.toLowerCase()) ? row.dataset.raw : [quantity, unit, item, note ? `(${note})` : ""].filter(Boolean).join(" ");
      return { raw, quantity, unit, item, note };
    })
    .filter(Boolean);
}

export function openRecipeEditor(ctx, { recipe, source = "manual", isNew = false, onSaved } = {}) {
  const r = recipe || { title: "", sourceUrl: "", servings: "", prepTime: "", cookTime: "", ingredients: [], instructions: [], tags: [] };
  const title = h("input", { type: "text", value: r.title || "", placeholder: "Recipe title", required: true });
  const sourceUrl = h("input", { type: "url", value: r.sourceUrl || "", placeholder: "https://..." });
  const servings = h("input", { type: "text", value: r.servings || "", placeholder: "4" });
  const prepTime = h("input", { type: "text", value: r.prepTime || "", placeholder: "15 min" });
  const cookTime = h("input", { type: "text", value: r.cookTime || "", placeholder: "45 min" });
  const tags = h("input", { type: "text", value: (r.tags || []).join(", "), placeholder: "dinner, italian, pasta" });
  const ingHost = h("div", {}, (r.ingredients || []).map(ingredientRow));
  const instructions = h("textarea", { rows: 10, placeholder: "One step per line" }, (r.instructions || []).join("\n"));

  const body = h(
    "div",
    {},
    isNew ? h("div", { class: `notice ${source === "ai" ? "warn" : ""}`, style: { marginBottom: "12px" } }, source === "jsonld" ? "Read from the site's structured data. Check it over, then save." : source === "ai" ? "Extracted by AI - please review quantities and steps before saving." : "Fill in the recipe and save.") : null,
    h("label", {}, "Title", title),
    h("label", {}, "Source URL", sourceUrl),
    h("div", { class: "field-row" }, h("label", {}, "Servings", servings), h("label", {}, "Tags", h("span", { class: "hint" }, "comma separated"), tags)),
    h("div", { class: "field-row" }, h("label", {}, "Prep time", prepTime), h("label", {}, "Cook time", cookTime)),
    h("h3", { style: { marginTop: "6px" } }, "Ingredients"),
    h("div", { class: "ing-head" }, h("span", {}, "Qty"), h("span", {}, "Unit"), h("span", {}, "Ingredient"), h("span")),
    ingHost,
    h("button", { type: "button", class: "btn small", onclick: () => { const row = ingredientRow(); ingHost.append(row); row.querySelector('[data-f="item"]').focus(); } }, svgIcon(ICONS.plus, 16), "Add ingredient"),
    h("h3", { style: { marginTop: "16px" } }, "Instructions"),
    h("label", {}, h("span", { class: "hint" }, "One step per line"), instructions),
  );

  openDialog({
    title: isNew ? "Review recipe" : "Edit recipe",
    body,
    actions: [
      { label: "Cancel", onClick: (close) => close() },
      {
        label: isNew ? "Save to library" : "Save changes",
        class: "primary",
        onClick: async (close) => {
          const data = {
            title: title.value.trim(),
            sourceUrl: sourceUrl.value.trim(),
            servings: servings.value.trim(),
            prepTime: prepTime.value.trim(),
            cookTime: cookTime.value.trim(),
            tags: tags.value.split(",").map((t) => t.trim()).filter(Boolean),
            ingredients: readIngredients(ingHost),
            instructions: instructions.value.split("\n").map((s) => s.trim()).filter(Boolean),
            source,
          };
          if (!data.title) return toast("A title is required", "error");
          if (!data.ingredients.length) return toast("Add at least one ingredient", "error");
          try {
            const res = isNew ? await api("/api/recipes", { method: "POST", body: data }) : await api(`/api/recipes/${r.id}`, { method: "PUT", body: data });
            invalidate();
            close();
            toast(isNew ? "Recipe saved" : "Changes saved", "ok");
            if (onSaved) onSaved(res.recipe);
            else ctx.navigate(`recipe/${res.recipe.id}`);
          } catch (err) {
            toast(err.message, "error", 5000);
          }
        },
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

async function renderDetail(container, ctx, id) {
  ctx.setTitle("Recipe");
  ctx.setActions(h("button", { class: "btn ghost small", onclick: () => ctx.navigate("library") }, svgIcon(ICONS.back, 18), "Library"));
  await loadIndex();
  let recipe;
  try {
    ({ recipe } = await api(`/api/recipes/${id}`));
  } catch (err) {
    container.append(h("div", { class: "empty" }, err.message));
    return;
  }
  if (!ctx.isCurrent()) return;

  const flagged = cache.weekIds.has(id);
  const star = h("button", { class: `btn star ${flagged ? "active" : ""}`, onclick: async () => { await toggleWeek(id, star); star.lastChild.textContent = cache.weekIds.has(id) ? " In This Week" : " Add to This Week"; } }, svgIcon(ICONS.star), flagged ? " In This Week" : " Add to This Week");

  container.append(
    h(
      "div",
      { class: "card" },
      h("h2", {}, recipe.title),
      h(
        "div",
        { class: "recipe-meta" },
        recipe.servings ? h("span", {}, "Serves ", h("b", {}, recipe.servings)) : null,
        recipe.prepTime ? h("span", {}, "Prep ", h("b", {}, recipe.prepTime)) : null,
        recipe.cookTime ? h("span", {}, "Cook ", h("b", {}, recipe.cookTime)) : null,
      ),
      recipe.tags?.length ? h("div", { class: "chips", style: { marginBottom: "10px" } }, recipe.tags.map((t) => h("span", { class: "chip" }, t))) : null,
      h(
        "div",
        { class: "row" },
        star,
        h("button", { class: "btn", onclick: () => openRecipeEditor(ctx, { recipe, source: recipe.source || "manual", onSaved: () => ctx.navigate(`recipe/${id}`) }) }, svgIcon(ICONS.edit, 18), "Edit"),
        h(
          "button",
          {
            class: "btn danger",
            onclick: async () => {
              if (!(await confirmDialog(`Delete "${recipe.title}"?`, { okLabel: "Delete", danger: true }))) return;
              try {
                await api(`/api/recipes/${id}`, { method: "DELETE" });
                invalidate();
                toast("Recipe deleted");
                ctx.navigate("library");
              } catch (err) {
                toast(err.message, "error");
              }
            },
          },
          svgIcon(ICONS.trash, 18),
          "Delete",
        ),
        recipe.sourceUrl ? h("a", { class: "btn ghost", href: recipe.sourceUrl, target: "_blank", rel: "noopener" }, svgIcon(ICONS.link, 18), "Source") : null,
      ),
    ),
    h(
      "div",
      { class: "card" },
      h("h3", {}, `Ingredients (${recipe.ingredients.length})`),
      h(
        "ul",
        { class: "ingredients" },
        recipe.ingredients.map((i) => h("li", {}, qtyText(i) ? h("span", { class: "qty" }, qtyText(i)) : null, i.item || i.raw, i.note ? h("span", { class: "muted" }, ` — ${i.note}`) : null)),
      ),
    ),
    h("div", { class: "card" }, h("h3", {}, "Instructions"), recipe.instructions.length ? h("ol", { class: "steps" }, recipe.instructions.map((s) => h("li", {}, s))) : h("p", { class: "muted" }, "No instructions saved.")),
  );
}
