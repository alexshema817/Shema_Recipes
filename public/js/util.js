// DOM + formatting helpers shared by all views.

export const STORE_SECTIONS = ["Produce", "Meat & Seafood", "Dairy & Eggs", "Bakery", "Deli", "Pantry", "Spices & Baking", "Frozen", "Beverages", "Other"];

/** h("div", { class: "x", onclick: fn, dataset: {...} }, child, [children]) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (k in el && typeof el[k] !== "function" && !(el instanceof SVGElement) && k !== "list") {
      try {
        el[k] = v;
      } catch {
        el.setAttribute(k, v);
      }
    } else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function svgIcon(path, size = 20) {
  const span = document.createElement("span");
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  return span.firstChild;
}

export const ICONS = {
  star: '<path d="M12 3l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 21l1.2-6.5L2.5 9.9 9.1 9z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4l10.5-10.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  check: '<path d="M5 12l5 5L20 7"/>',
  cart: '<path d="M3 4h2l2.5 11h11L21 7H6.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5L20 16M20 20v-4h-4"/>',
};

export function fmtQty(n) {
  if (n == null || n === "") return "";
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  if (num === 0) return "0";
  const whole = Math.floor(num);
  const frac = num - whole;
  const fracs = [
    [0, ""], [0.125, "1/8"], [0.25, "1/4"], [1 / 3, "1/3"], [0.375, "3/8"], [0.5, "1/2"],
    [0.625, "5/8"], [2 / 3, "2/3"], [0.75, "3/4"], [0.875, "7/8"], [1, ""],
  ];
  let best = fracs[0];
  let bestDiff = Infinity;
  for (const f of fracs) {
    const d = Math.abs(f[0] - frac);
    if (d < bestDiff) {
      bestDiff = d;
      best = f;
    }
  }
  if (bestDiff > 0.02) return String(Math.round(num * 100) / 100);
  let w = whole;
  let fs = best[1];
  if (best[0] === 1) {
    w += 1;
    fs = "";
  }
  if (w === 0) return fs || "0";
  return fs ? `${w} ${fs}` : String(w);
}

export function qtyText(item) {
  return [fmtQty(item.quantity), item.unit].filter(Boolean).join(" ");
}

export function extractUrl(text) {
  const m = String(text || "").match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[.,;)]+$/, "") : "";
}

export function debounce(fn, ms = 400) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// ---------------------------------------------------------------------------
// Toasts, dialogs, busy overlay
// ---------------------------------------------------------------------------

export function toast(message, type = "", ms = 3200) {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = h("div", { class: `toast ${type}` }, message);
  host.append(el);
  setTimeout(() => el.remove(), ms);
}

/**
 * openDialog({ title, body: Node, actions: [{ label, class, onClick(close) }] })
 * Returns { dialog, close }.
 */
export function openDialog({ title, body, actions = [], onClose } = {}) {
  const dialog = h("dialog", { class: "dlg" });
  const close = (value) => {
    if (!dialog.open) return;
    dialog.close();
    dialog.remove();
    onClose?.(value);
  };
  const head = h(
    "div",
    { class: "dlg-head" },
    h("h2", {}, title || ""),
    h("button", { class: "btn ghost icon", type: "button", "aria-label": "Close", onclick: () => close() }, svgIcon(ICONS.close)),
  );
  const bodyEl = h("div", { class: "dlg-body" }, body);
  const foot = actions.length
    ? h(
        "div",
        { class: "dlg-foot" },
        actions.map((a) =>
          h(
            "button",
            {
              class: `btn ${a.class || ""}`,
              type: "button",
              onclick: async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                try {
                  await a.onClick?.(close, btn);
                } finally {
                  btn.disabled = false;
                }
              },
            },
            a.label,
          ),
        ),
      )
    : null;
  append(dialog, [head, bodyEl, foot]);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close, body: bodyEl };
}

export function confirmDialog(message, { okLabel = "OK", danger = false, title = "Are you sure?" } = {}) {
  return new Promise((resolve) => {
    openDialog({
      title,
      body: h("p", {}, message),
      onClose: (v) => resolve(v === true),
      actions: [
        { label: "Cancel", onClick: (close) => close(false) },
        { label: okLabel, class: danger ? "danger solid" : "primary", onClick: (close) => close(true) },
      ],
    });
  });
}

export function showBusy(text = "Working...") {
  const label = h("div", {}, text);
  const el = h("div", { class: "busy" }, h("div", { class: "box" }, h("div", { class: "spinner" }), label));
  document.body.append(el);
  return {
    update: (t) => (label.textContent = t),
    close: () => el.remove(),
  };
}
