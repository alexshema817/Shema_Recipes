// Kroger UI pieces shared by the Grocery and Settings views.
import { api } from "../api.js";
import { h, toast, openDialog } from "../util.js";

export function connectKroger() {
  location.href = "/api/kroger/auth";
}

/** ZIP search -> pick a store -> saved to settings. Resolves with the chosen location or null. */
export function chooseStoreDialog(current = {}) {
  return new Promise((resolve) => {
    const zip = h("input", { type: "text", inputmode: "numeric", pattern: "[0-9]*", maxlength: 5, placeholder: "ZIP code", autocomplete: "postal-code" });
    const results = h("div", { class: "stack", style: { marginTop: "12px" } });
    let chosen = null;

    const search = async () => {
      const z = zip.value.trim();
      if (!/^\d{5}$/.test(z)) return toast("Enter a 5-digit ZIP", "error");
      results.replaceChildren(h("p", { class: "muted" }, "Searching..."));
      try {
        const { locations } = await api(`/api/kroger/locations?zip=${z}`);
        results.replaceChildren();
        if (!locations.length) results.append(h("p", { class: "muted" }, "No stores found near that ZIP."));
        for (const loc of locations) {
          results.append(
            h(
              "div",
              { class: "card clickable", onclick: async () => {
                try {
                  await api("/api/settings", { method: "PUT", body: { locationId: loc.locationId, locationName: `${loc.name} (${loc.address})` } });
                  chosen = loc;
                  toast(`Store set: ${loc.name}`, "ok");
                  dlg.close();
                } catch (err) {
                  toast(err.message, "error");
                }
              } },
              h("p", { class: "card-title" }, loc.name),
              h("div", { class: "card-sub" }, `${loc.chain ? loc.chain + " · " : ""}${loc.address}`),
            ),
          );
        }
      } catch (err) {
        results.replaceChildren(h("p", { class: "error" }, err.message));
      }
    };
    zip.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        search();
      }
    });

    const dlg = openDialog({
      title: "Choose your Kroger store",
      body: h("div", {}, current.locationName ? h("p", { class: "muted small" }, `Current: ${current.locationName}`) : null, h("div", { class: "row" }, h("div", { class: "grow" }, zip), h("button", { class: "btn primary", onclick: search }, "Search")), results),
      onClose: () => resolve(chosen),
    });
    zip.focus();
  });
}
