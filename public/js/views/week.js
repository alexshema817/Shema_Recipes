// This Week: flagged recipes with per-recipe servings multiplier, unflag, and "Build Grocery List".
import { api, startBackground, pollJob } from "../api.js";
import { h, svgIcon, ICONS, toast, showBusy, confirmDialog, debounce, fmtQty } from "../util.js";
import { invalidate as invalidateLibrary } from "./library.js";

export async function render(container, ctx) {
  const week = await api("/api/week");
  if (!ctx.isCurrent()) return;
  let items = week.items;

  const save = debounce(async () => {
    try {
      await api("/api/week", { method: "PUT", body: { items: items.map((w) => ({ id: w.id, multiplier: w.multiplier })) } });
    } catch (err) {
      toast(err.message, "error");
    }
  }, 500);

  const list = h("div", { class: "stack" });
  const includeStaples = h("input", { type: "checkbox" });
  const buildBtn = h("button", { class: "btn primary block", onclick: () => build() }, svgIcon(ICONS.cart), "Build Grocery List");

  const draw = () => {
    list.replaceChildren();
    if (!items.length) {
      list.append(h("div", { class: "empty" }, h("p", {}, "Nothing flagged for this week."), h("p", { class: "small" }, "Tap the star on a recipe in the Library to add it here."), h("button", { class: "btn", onclick: () => ctx.navigate("library") }, "Go to Library")));
      buildBtn.disabled = true;
      return;
    }
    buildBtn.disabled = false;
    for (const w of items) list.append(weekCard(w));
  };

  const weekCard = (w) => {
    const value = h("span", {}, `${fmtQty(w.multiplier)}x`);
    const setMult = (m) => {
      w.multiplier = Math.max(0.25, Math.min(20, Math.round(m * 4) / 4));
      value.textContent = `${fmtQty(w.multiplier)}x`;
      save();
    };
    return h(
      "div",
      { class: "card" },
      h("div", { class: "row between" }, h("div", { class: "grow" }, h("p", { class: "card-title", style: { cursor: "pointer" }, onclick: () => ctx.navigate(`recipe/${w.id}`) }, w.title), h("div", { class: "card-sub" }, w.servings ? `Base: ${w.servings}` : "Servings not set")), null),
      h(
        "div",
        { class: "row between", style: { marginTop: "10px" } },
        h("div", { class: "row" }, h("span", { class: "muted small" }, "Scale"), h("div", { class: "stepper" }, h("button", { type: "button", "aria-label": "Less", onclick: () => setMult(w.multiplier - (w.multiplier <= 1 ? 0.25 : 0.5)) }, "−"), value, h("button", { type: "button", "aria-label": "More", onclick: () => setMult(w.multiplier + (w.multiplier < 1 ? 0.25 : 0.5)) }, "+"))),
        h(
          "button",
          {
            class: "btn small",
            onclick: async () => {
              try {
                const res = await api("/api/week/toggle", { method: "POST", body: { id: w.id } });
                items = res.items;
                invalidateLibrary();
                draw();
              } catch (err) {
                toast(err.message, "error");
              }
            },
          },
          "Unflag",
        ),
      ),
    );
  };

  async function build() {
    let list;
    try {
      list = await api("/api/grocery-list");
    } catch {
      list = { items: [] };
    }
    if (list.items?.length) {
      const ok = await confirmDialog("This replaces your current grocery list (including manual items and check marks). Continue?", { okLabel: "Build list", title: "Replace grocery list?" });
      if (!ok) return;
    }
    const busy = showBusy("Starting...");
    try {
      const { jobId } = await api("/api/build-list", { method: "POST", body: { includeStaples: includeStaples.checked } });
      busy.update("Consolidating ingredients with AI... this usually takes 20-90 seconds.");
      await startBackground("/api/build-list-background", { jobId });
      const result = await pollJob(jobId, { onTick: (_j, elapsed) => busy.update(`Consolidating ingredients with AI... ${Math.round(elapsed / 1000)}s`) });
      busy.close();
      toast(`Grocery list built: ${result.count} items`, "ok");
      ctx.navigate("grocery");
    } catch (err) {
      busy.close();
      toast(err.message, "error", 6000);
    }
  }

  container.append(
    h("p", { class: "muted small" }, "Adjust how much of each recipe you are making, then build one consolidated grocery list."),
    list,
    h("div", { class: "card", style: { marginTop: "16px" } }, h("label", { class: "checkbox" }, includeStaples, "Include pantry staples (salt, oil, ... from Settings)"), buildBtn),
  );
  draw();
}
