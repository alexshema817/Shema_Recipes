// Preferences: ingredient term -> pinned Kroger product and/or brand/keyword hint.
// Learned picks (from "Send to Kroger Cart") are listed here too and can be edited or deleted.
import { api } from "../api.js";
import { h, svgIcon, ICONS, toast, openDialog, confirmDialog } from "../util.js";

const productLine = (p) => [p.brand, p.description, p.size].filter(Boolean).join(" · ");
const priceText = (p) => (p?.price != null ? `$${Number(p.price).toFixed(2)}` : "");

export async function render(container, ctx) {
  const data = await api("/api/preferences");
  if (!ctx.isCurrent()) return;
  let prefs = data.preferences || [];

  ctx.setActions(h("button", { class: "btn small", onclick: () => openEditor(null) }, svgIcon(ICONS.plus, 18), "Add"));

  const help = h(
    "p",
    { class: "muted small" },
    "A preference applies to a grocery item when all of its words appear as whole words, in order, in the item name: \"milk\" matches \"whole milk\" and \"2% milk\" but not \"buttermilk\". When several match, the most specific wins (\"coconut milk\" beats \"milk\"). Plurals count (egg/eggs). Pinned products are pre-selected when matching; hints are added to the Kroger search.",
  );
  const listHost = h("div", {});

  const draw = () => {
    listHost.replaceChildren();
    if (!prefs.length) {
      listHost.append(h("div", { class: "empty" }, h("p", {}, "No preferences yet."), h("p", { class: "small" }, "Pin your usual milk, eggs or butter, or add a brand hint. Products you send to the cart are remembered here automatically."), h("button", { class: "btn primary", onclick: () => openEditor(null) }, svgIcon(ICONS.plus, 18), "Add preference")));
      return;
    }
    const ul = h("ul", { class: "list card", style: { padding: "4px 14px" } });
    for (const p of prefs) {
      ul.append(
        h(
          "li",
          {},
          h(
            "div",
            { class: "name", onclick: () => openEditor(p) },
            h("span", {}, p.term, p.source === "learned" ? h("span", { class: "chip neutral", style: { marginLeft: "6px" } }, "learned") : null),
            p.product ? h("small", {}, `Pinned: ${productLine(p.product) || `UPC ${p.product.upc}`}${priceText(p.product) ? ` · ${priceText(p.product)}` : ""}`) : null,
            p.hint ? h("small", {}, `Hint: ${p.hint}`) : null,
          ),
          h("button", { class: "btn ghost icon small", "aria-label": "Edit", onclick: () => openEditor(p) }, svgIcon(ICONS.edit, 18)),
          h("button", { class: "btn ghost icon small", "aria-label": "Delete", onclick: () => removePref(p) }, svgIcon(ICONS.trash, 18)),
        ),
      );
    }
    listHost.append(ul);
  };

  async function removePref(p) {
    if (!(await confirmDialog(`Delete the preference for "${p.term}"?`, { okLabel: "Delete", danger: true }))) return;
    try {
      const res = await api(`/api/preferences?term=${encodeURIComponent(p.term)}`, { method: "DELETE" });
      prefs = res.preferences;
      draw();
      toast("Deleted");
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function openEditor(pref) {
    const isNew = !pref;
    let pinned = pref?.product ? { ...pref.product } : null;

    const term = h("input", { type: "text", value: pref?.term || "", placeholder: "e.g. milk, eggs, coconut milk", maxlength: 60, autocapitalize: "none" });
    const hint = h("input", { type: "text", value: pref?.hint || "", placeholder: "e.g. Kerrygold, Vital Farms large brown", maxlength: 80 });

    // ---- pinned product box
    const pinnedBox = h("div", { class: "pinned-box" });
    const drawPinned = () => {
      pinnedBox.replaceChildren();
      if (!pinned) {
        pinnedBox.append(h("span", { class: "muted small" }, "No product pinned. Search below or enter a UPC."));
        return;
      }
      pinnedBox.append(
        h("div", { class: "grow" }, h("div", {}, svgIcon(ICONS.check, 16), " ", pinned.description || `UPC ${pinned.upc}`), h("div", { class: "muted small" }, [pinned.brand, pinned.size, priceText(pinned), `UPC ${pinned.upc}`].filter(Boolean).join(" · "))),
        h("button", { class: "btn small", type: "button", onclick: () => { pinned = null; drawPinned(); } }, "Unpin"),
      );
    };
    drawPinned();

    const pin = (product) => {
      pinned = { upc: product.upc, productId: product.productId || "", description: product.description || "", brand: product.brand || "", size: product.size || "", price: product.price ?? null };
      drawPinned();
      searchResults.replaceChildren();
      lookupResult.replaceChildren();
      toast("Pinned - remember to save", "ok");
    };

    const resultRow = (p) =>
      h(
        "div",
        { class: "option" },
        h("span", { class: "desc" }, p.description, h("small", {}, [p.brand, p.size, p.price != null ? `$${Number(p.price).toFixed(2)}` : "", `UPC ${p.upc}`].filter(Boolean).join(" · "))),
        h("button", { class: "btn small", type: "button", onclick: () => pin(p) }, "Pin"),
      );

    // ---- search
    const searchInput = h("input", { type: "search", placeholder: "Search Kroger products", maxlength: 120 });
    const searchResults = h("div", { class: "stack" });
    const runSearch = async () => {
      const q = searchInput.value.trim() || term.value.trim();
      if (q.length < 2) return toast("Type something to search for", "error");
      if (!searchInput.value.trim()) searchInput.value = q;
      searchResults.replaceChildren(h("p", { class: "muted small" }, "Searching..."));
      try {
        const res = await api(`/api/kroger/products?term=${encodeURIComponent(q)}`);
        searchResults.replaceChildren();
        if (!res.locationId) searchResults.append(h("p", { class: "muted small" }, "No store chosen (Settings) - results are not store-specific."));
        if (!res.products.length) searchResults.append(h("p", { class: "muted small" }, `No products found for "${res.term}".`));
        for (const p of res.products) searchResults.append(resultRow(p));
      } catch (err) {
        searchResults.replaceChildren(h("p", { class: "error small" }, err.message));
      }
    };
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runSearch();
      }
    });

    // ---- UPC / product id lookup
    const upcInput = h("input", { type: "text", inputmode: "numeric", placeholder: "UPC or Kroger product ID", maxlength: 20, autocomplete: "off" });
    const lookupResult = h("div", { class: "stack" });
    const runLookup = async () => {
      const digits = upcInput.value.replace(/\D/g, "");
      if (!/^\d{8,14}$/.test(digits)) return toast("Enter an 8-14 digit UPC or product ID", "error");
      lookupResult.replaceChildren(h("p", { class: "muted small" }, "Looking up..."));
      try {
        const res = await api(`/api/kroger/products?id=${encodeURIComponent(digits)}`);
        lookupResult.replaceChildren();
        if (res.product) {
          lookupResult.append(h("p", { class: "muted small", style: { margin: "0 0 4px" } }, "Found at Kroger - pin it?"), resultRow(res.product));
          return;
        }
        // Not found: allow pinning the code alone with a typed description.
        const desc = h("input", { type: "text", placeholder: "Description (optional)", maxlength: 160 });
        lookupResult.append(
          h("div", { class: "notice warn small" }, `Kroger did not return a product for ${res.id}. You can still pin it by code; it will be sent to the cart as-is.`),
          h("label", {}, "Description", desc),
          h("button", { class: "btn small", type: "button", onclick: () => pin({ upc: res.id, productId: res.id, description: desc.value.trim(), brand: "", size: "", price: null }) }, `Pin UPC ${res.id}`),
        );
      } catch (err) {
        lookupResult.replaceChildren(h("p", { class: "error small" }, err.message));
      }
    };
    upcInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runLookup();
      }
    });

    const body = h(
      "div",
      {},
      h("label", {}, "Ingredient term", h("span", { class: "hint" }, "Matched as whole words against grocery item names."), term),
      h("label", {}, "Brand / keyword hint (optional)", h("span", { class: "hint" }, "Added to the Kroger search for this item."), hint),
      h("label", {}, "Pinned product (optional)"),
      pinnedBox,
      h("div", { class: "row", style: { marginTop: "10px" } }, h("div", { class: "grow" }, searchInput), h("button", { class: "btn", type: "button", onclick: runSearch }, svgIcon(ICONS.search, 18), "Find")),
      searchResults,
      h("div", { class: "row", style: { marginTop: "10px" } }, h("div", { class: "grow" }, upcInput), h("button", { class: "btn", type: "button", onclick: runLookup }, "Look up")),
      lookupResult,
    );

    openDialog({
      title: isNew ? "Add preference" : "Edit preference",
      body,
      actions: [
        { label: "Cancel", onClick: (close) => close() },
        {
          label: isNew ? "Add" : "Save",
          class: "primary",
          onClick: async (close) => {
            const t = term.value.trim();
            if (t.length < 2) return toast("Enter an ingredient term", "error");
            if (!pinned && !hint.value.trim()) return toast("Pin a product or enter a hint", "error");
            try {
              const res = await api("/api/preferences", { method: "PUT", body: { term: t, hint: hint.value.trim(), product: pinned, originalTerm: pref?.term || "" } });
              prefs = res.preferences;
              draw();
              close();
              toast(isNew ? "Preference added" : "Preference saved", "ok");
            } catch (err) {
              toast(err.message, "error");
            }
          },
        },
      ],
    });
    (isNew ? term : hint).focus();
  }

  container.append(help, listHost);
  draw();
}
