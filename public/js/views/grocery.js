// Grocery List: grouped editable list + Kroger match / send to cart.
import { api } from "../api.js";
import { h, svgIcon, ICONS, toast, openDialog, confirmDialog, showBusy, qtyText, fmtQty, debounce, STORE_SECTIONS } from "../util.js";
import { connectKroger, chooseStoreDialog } from "./kroger-ui.js";

export async function render(container, ctx) {
  const [list, kroger] = await Promise.all([api("/api/grocery-list"), api("/api/kroger/status").catch((e) => ({ connected: false, error: e.message }))]);
  if (!ctx.isCurrent()) return;
  let items = list.items || [];
  let status = kroger;

  const persist = debounce(async () => {
    try {
      await api("/api/grocery-list", { method: "PUT", body: { items } });
    } catch (err) {
      toast(err.message, "error");
    }
  }, 400);

  // ---- header actions
  ctx.setActions(
    h("button", { class: "btn small", onclick: () => openItemEditor(null) }, svgIcon(ICONS.plus, 18), "Item"),
  );

  // ---- list
  const listHost = h("div", {});
  const summary = h("p", { class: "muted small" });

  const draw = () => {
    listHost.replaceChildren();
    const unchecked = items.filter((i) => !i.checked).length;
    summary.textContent = items.length ? `${unchecked} to buy · ${items.length - unchecked} done${list.fromWeek?.length ? ` · from ${list.fromWeek.length} recipe${list.fromWeek.length === 1 ? "" : "s"}` : ""}` : "";
    if (!items.length) {
      listHost.append(h("div", { class: "empty" }, h("p", {}, "Your grocery list is empty."), h("p", { class: "small" }, "Build it from This Week, or add items manually."), h("button", { class: "btn", onclick: () => ctx.navigate("week") }, "Go to This Week")));
      return;
    }
    const bySection = new Map();
    for (const it of items) {
      const s = STORE_SECTIONS.includes(it.section) ? it.section : "Other";
      if (!bySection.has(s)) bySection.set(s, []);
      bySection.get(s).push(it);
    }
    for (const section of STORE_SECTIONS) {
      const group = bySection.get(section);
      if (!group) continue;
      listHost.append(h("div", { class: "section-title" }, h("span", {}, section), h("span", {}, `${group.filter((g) => !g.checked).length}/${group.length}`)));
      const ul = h("ul", { class: "list card", style: { padding: "4px 14px" } });
      for (const it of group) ul.append(itemRow(it));
      listHost.append(ul);
    }
  };

  const itemRow = (it) => {
    const cb = h("input", { type: "checkbox", checked: !!it.checked, onchange: () => { it.checked = cb.checked; li.classList.toggle("checked", it.checked); persist(); draw(); } });
    const li = h(
      "li",
      { class: it.checked ? "checked" : "" },
      h("label", { class: "checkbox", style: { margin: 0 } }, cb),
      h("div", { class: "name", onclick: () => openItemEditor(it) }, it.name, h("small", {}, [qtyText(it), it.fromRecipes?.length ? it.fromRecipes.join(", ") : it.manual ? "added manually" : ""].filter(Boolean).join(" · "))),
      h("button", { class: "btn ghost icon small", "aria-label": "Delete", onclick: async () => { items = items.filter((x) => x !== it); persist(); draw(); } }, svgIcon(ICONS.trash, 18)),
    );
    return li;
  };

  function openItemEditor(item) {
    const isNew = !item;
    const name = h("input", { type: "text", value: item?.name || "", placeholder: "Item name" });
    const qty = h("input", { type: "text", inputmode: "decimal", value: item?.quantity != null ? fmtQty(item.quantity) : "", placeholder: "Qty" });
    const unit = h("input", { type: "text", value: item?.unit || "", placeholder: "Unit" });
    const section = h("select", {}, STORE_SECTIONS.map((s) => h("option", { value: s, selected: (item?.section || "Other") === s }, s)));
    openDialog({
      title: isNew ? "Add item" : "Edit item",
      body: h("div", {}, h("label", {}, "Name", name), h("div", { class: "field-row" }, h("label", {}, "Quantity", qty), h("label", {}, "Unit", unit)), h("label", {}, "Section", section)),
      actions: [
        { label: "Cancel", onClick: (close) => close() },
        {
          label: isNew ? "Add" : "Save",
          class: "primary",
          onClick: (close) => {
            if (!name.value.trim()) return toast("Enter a name", "error");
            const data = { name: name.value.trim(), quantity: parseQty(qty.value), unit: unit.value.trim(), section: section.value };
            if (isNew) items.push({ id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, ...data, fromRecipes: [], checked: false, manual: true });
            else Object.assign(item, data);
            persist();
            draw();
            close();
          },
        },
      ],
    });
    name.focus();
  }

  // ---- Kroger panel
  const krogerPanel = h("div", { class: "card", style: { marginTop: "18px" } });
  const drawKroger = () => {
    krogerPanel.replaceChildren(h("h3", {}, "Kroger"));
    if (status.error) {
      krogerPanel.append(h("p", { class: "error small" }, status.error));
    }
    if (status.configured === false) {
      krogerPanel.append(h("div", { class: "notice warn" }, "Kroger is not configured on the server (KROGER_CLIENT_ID / KROGER_CLIENT_SECRET / KROGER_REDIRECT_URI)."));
      return;
    }
    krogerPanel.append(
      h("p", { class: "small" }, status.connected ? h("span", { class: "chip" }, "Account connected") : h("span", { class: "chip neutral" }, "Account not connected"), " ", status.locationName ? h("span", { class: "chip" }, status.locationName) : h("span", { class: "chip neutral" }, "No store chosen")),
      h(
        "div",
        { class: "row" },
        status.connected ? null : h("button", { class: "btn", onclick: connectKroger }, "Connect Kroger"),
        h("button", { class: "btn", onclick: async () => { const loc = await chooseStoreDialog(status); if (loc) { status = await api("/api/kroger/status"); drawKroger(); } } }, status.locationId ? "Change store" : "Choose store"),
        h("button", { class: "btn primary", disabled: !status.locationId || !items.some((i) => !i.checked), onclick: matchToKroger }, svgIcon(ICONS.search, 18), "Match to Kroger"),
      ),
      h("p", { class: "muted small", style: { marginTop: "10px", marginBottom: 0 } }, "Matching finds products at your store for every unchecked item; you pick one per item, then send them to your Kroger cart. Checkout happens in the Kroger app or website."),
    );
  };

  async function matchToKroger() {
    const toMatch = items.filter((i) => !i.checked).map((i) => ({ id: i.id, name: i.name }));
    if (!toMatch.length) return toast("Everything is checked off", "error");
    const busy = showBusy(`Searching Kroger for ${toMatch.length} items...`);
    let data;
    try {
      data = await api("/api/kroger/match", { method: "POST", body: { items: toMatch } });
    } catch (err) {
      busy.close();
      if (err.code === "NO_LOCATION") {
        const loc = await chooseStoreDialog(status);
        if (loc) {
          status = await api("/api/kroger/status");
          drawKroger();
          return matchToKroger();
        }
        return;
      }
      return toast(err.message, "error", 6000);
    }
    busy.close();
    openMatchDialog(data.results);
  }

  function openMatchDialog(results) {
    const picks = new Map(); // itemId -> { upc, option, count }
    const body = h("div", {});
    body.append(h("p", { class: "muted small" }, `Showing products at ${status.locationName || "your store"}. Sorted by lowest unit price; the cheapest is pre-selected unless you've set a preference on the Preferences tab.`));
    for (const r of results) {
      const name = `pick-${r.itemId}`;
      const count = h("input", { type: "number", class: "count", min: 1, max: 99, value: 1, "aria-label": "How many" });
      const groupEl = h("div", { class: "match-item" }, h("div", { class: "match-name" }, h("span", {}, r.name), h("span", { class: "row" }, h("span", { class: "muted small" }, "Qty"), count)));
      if (r.preference) {
        const p = r.preference;
        const parts = [];
        if (p.product) parts.push(`Preference: ${p.term} → ${[p.product.brand, p.product.description, p.product.size].filter(Boolean).join(" ") || `UPC ${p.product.upc}`}`);
        if (p.hint) parts.push(`Hint: ${p.hint}`);
        groupEl.append(h("p", { class: "match-pref small" }, parts.join(" · ")));
      }
      if (r.error) groupEl.append(h("p", { class: "error small" }, r.error));
      if (!r.options.length && !r.error) groupEl.append(h("p", { class: "muted small" }, `No products found for "${r.term}".`));
      const setPick = (opt) => {
        if (opt) picks.set(r.itemId, { upc: opt.upc, option: opt, count });
        else picks.delete(r.itemId);
      };
      for (const opt of r.options) {
        const radio = h("input", { type: "radio", name, value: opt.upc, checked: r.selectedUpc === opt.upc, onchange: () => setPick(opt) });
        if (r.selectedUpc === opt.upc) setPick(opt);
        groupEl.append(
          h(
            "label",
            { class: "option" },
            radio,
            h("span", { class: "desc" }, opt.description, h("small", {}, [opt.brand, opt.size, opt.pinned ? (opt.snapshot ? "pinned · price unavailable" : "pinned") : "", opt.cheapest ? "lowest unit price" : ""].filter(Boolean).join(" · "))),
            h("span", { class: "price" }, opt.price != null ? `$${Number(opt.price).toFixed(2)}` : "", opt.unitPriceLabel ? h("small", { class: "unit-price" }, opt.unitPriceLabel) : null),
          ),
        );
      }
      groupEl.append(h("label", { class: "option" }, h("input", { type: "radio", name, value: "", checked: !r.selectedUpc, onchange: () => setPick(null) }), h("span", { class: "desc muted" }, "Skip this item")));
      body.append(groupEl);
    }

    openDialog({
      title: "Match to Kroger",
      body,
      actions: [
        { label: "Cancel", onClick: (close) => close() },
        {
          label: "Send to Kroger Cart",
          class: "primary",
          onClick: async (close) => {
            const payload = [];
            for (const r of results) {
              const p = picks.get(r.itemId);
              if (!p) continue;
              payload.push({ itemId: r.itemId, name: r.name, upc: p.upc, productId: p.option.productId || "", quantity: Number(p.count.value) || 1, description: p.option.description, size: p.option.size, brand: p.option.brand });
            }
            if (!payload.length) return toast("Pick at least one product", "error");
            if (!status.connected) {
              const ok = await confirmDialog("Your Kroger account is not connected yet. Connect now? (You will need to match again afterwards.)", { okLabel: "Connect Kroger", title: "Connect Kroger" });
              if (ok) connectKroger();
              return;
            }
            const busy = showBusy(`Adding ${payload.length} items to your Kroger cart...`);
            try {
              const res = await api("/api/kroger/cart", { method: "POST", body: { items: payload } });
              busy.close();
              close();
              showCartSummary(res);
            } catch (err) {
              busy.close();
              if (err.code === "KROGER_NOT_CONNECTED") {
                status.connected = false;
                drawKroger();
                const ok = await confirmDialog(err.message, { okLabel: "Connect Kroger", title: "Kroger" });
                if (ok) connectKroger();
                return;
              }
              toast(err.message, "error", 6000);
            }
          },
        },
      ],
    });
  }

  function showCartSummary(res) {
    const okIds = new Set(res.results.filter((r) => r.ok).map((r) => r.itemId));
    const body = h(
      "div",
      {},
      h("div", { class: `notice ${res.failed ? "warn" : "ok"}` }, `${res.added} added to your Kroger cart${res.failed ? `, ${res.failed} failed` : ""}.`),
      h("ul", { class: "list", style: { marginTop: "10px" } }, res.results.map((r) => h("li", {}, h("span", { class: "name" }, r.ok ? svgIcon(ICONS.check, 16) : null, ` ${r.name}`, h("small", {}, r.ok ? `x${r.quantity} · UPC ${r.upc}` : r.error || "failed"))))),
      h("p", { class: "muted small", style: { marginTop: "12px" } }, "Open the Kroger app or kroger.com to review your cart and check out (pickup)."),
      res.added ? h("label", { class: "checkbox" }, h("input", { type: "checkbox", id: "mark-done", checked: true }), "Check off the added items on my list") : null,
    );
    openDialog({
      title: "Sent to Kroger",
      body,
      actions: [
        {
          label: "Done",
          class: "primary",
          onClick: (close) => {
            const mark = body.querySelector("#mark-done");
            if (mark?.checked) {
              for (const it of items) if (okIds.has(it.id)) it.checked = true;
              persist();
              draw();
              drawKroger();
            }
            close();
          },
        },
      ],
    });
  }

  container.append(summary, listHost, krogerPanel);
  draw();
  drawKroger();
}

function parseQty(s) {
  const str = String(s || "").trim();
  if (!str) return null;
  const m = str.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  const f = str.match(/^(\d+)\/(\d+)$/);
  if (f) return Number(f[1]) / Number(f[2]);
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}
