// Settings: pantry staples, Kroger store + connection, remembered products, sign out.
import { api } from "../api.js";
import { h, toast, confirmDialog } from "../util.js";
import { connectKroger, chooseStoreDialog } from "./kroger-ui.js";

export async function render(container, ctx) {
  const [{ settings }, kroger, productMap] = await Promise.all([
    api("/api/settings"),
    api("/api/kroger/status").catch((e) => ({ connected: false, error: e.message })),
    api("/api/kroger/product-map").catch(() => ({ count: 0 })),
  ]);
  if (!ctx.isCurrent()) return;
  let status = kroger;

  // ---- pantry staples
  const staples = h("textarea", { rows: 10 }, settings.pantryStaples.join("\n"));
  const staplesCard = h(
    "div",
    { class: "card" },
    h("h3", {}, "Pantry staples"),
    h("p", { class: "muted small" }, "One per line. These are left off generated grocery lists unless you tick \"Include pantry staples\" when building."),
    staples,
    h("button", { class: "btn primary", style: { marginTop: "8px" }, onclick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const list = staples.value.split("\n").map((s) => s.trim()).filter(Boolean);
        const res = await api("/api/settings", { method: "PUT", body: { pantryStaples: list } });
        staples.value = res.settings.pantryStaples.join("\n");
        toast("Pantry staples saved", "ok");
      } catch (err) {
        toast(err.message, "error");
      } finally {
        btn.disabled = false;
      }
    } }, "Save staples"),
  );

  // ---- Kroger
  const krogerCard = h("div", { class: "card" });
  const drawKroger = () => {
    krogerCard.replaceChildren(h("h3", {}, "Kroger"));
    if (status.configured === false) krogerCard.append(h("div", { class: "notice warn" }, "Kroger API credentials or redirect URI are not configured on the server."));
    krogerCard.append(
      h("p", { class: "small" }, h("b", {}, "Store: "), status.locationName || h("span", { class: "muted" }, "none chosen")),
      h("button", { class: "btn", onclick: async () => { const loc = await chooseStoreDialog(status); if (loc) { status = await api("/api/kroger/status"); drawKroger(); } } }, status.locationId ? "Change store" : "Choose store"),
      h("p", { class: "small", style: { marginTop: "14px" } }, h("b", {}, "Account: "), status.connected ? `connected${status.connectedAt ? ` since ${new Date(status.connectedAt).toLocaleDateString()}` : ""}` : h("span", { class: "muted" }, "not connected")),
      h(
        "div",
        { class: "row" },
        h("button", { class: "btn", onclick: connectKroger }, status.connected ? "Reconnect Kroger" : "Connect Kroger"),
        status.connected
          ? h("button", { class: "btn danger", onclick: async () => {
            if (!(await confirmDialog("Disconnect your Kroger account? You can reconnect any time.", { okLabel: "Disconnect", danger: true }))) return;
            await api("/api/kroger/status", { method: "DELETE" });
            status = await api("/api/kroger/status");
            drawKroger();
            toast("Kroger disconnected");
          } }, "Disconnect")
          : null,
      ),
      h("p", { class: "muted small", style: { marginTop: "10px" } }, "Connecting grants this app permission to add items to your Kroger cart (scopes: cart.basic:write, product.compact, profile.compact). Tokens are stored server-side and refreshed automatically."),
    );
  };
  drawKroger();

  // ---- remembered products
  const countEl = h("span", {}, String(productMap.count || 0));
  const mapCard = h(
    "div",
    { class: "card" },
    h("h3", {}, "Remembered Kroger products"),
    h("p", { class: "muted small" }, "When you pick a product for an ingredient, the choice is remembered so it is pre-selected next time. ", h("b", {}, countEl), " remembered."),
    h("button", { class: "btn danger", onclick: async () => {
      if (!(await confirmDialog("Forget all remembered product picks?", { okLabel: "Forget all", danger: true }))) return;
      await api("/api/kroger/product-map", { method: "DELETE" });
      countEl.textContent = "0";
      toast("Cleared");
    } }, "Forget all picks"),
  );

  // ---- account
  const accountCard = h(
    "div",
    { class: "card" },
    h("h3", {}, "Account"),
    h("p", { class: "muted small" }, "Signed in with a 30-day session cookie."),
    h("button", { class: "btn", onclick: async () => {
      await api("/api/logout", { method: "POST" }).catch(() => {});
      location.replace("/login.html");
    } }, "Sign out"),
  );

  container.append(staplesCard, krogerCard, mapCard, accountCard);
}
