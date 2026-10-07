// Settings: pantry staples, Kroger store + connection, product preferences summary, sign out.
import { api } from "../api.js";
import { h, toast, confirmDialog } from "../util.js";
import { connectKroger, chooseStoreDialog } from "./kroger-ui.js";

export async function render(container, ctx) {
  const [{ settings }, kroger, prefData] = await Promise.all([
    api("/api/settings"),
    api("/api/kroger/status").catch((e) => ({ connected: false, error: e.message })),
    api("/api/preferences").catch(() => ({ preferences: [] })),
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

  // ---- product preferences (managed on the Preferences tab)
  let prefList = prefData.preferences || [];
  const countEl = h("span", {});
  const learnedBtn = h("button", { class: "btn danger", onclick: async () => {
    if (!(await confirmDialog("Forget all automatically learned product picks? Preferences you added yourself are kept.", { okLabel: "Forget learned", danger: true }))) return;
    try {
      const res = await api("/api/preferences?source=learned", { method: "DELETE" });
      prefList = res.preferences;
      drawCount();
      toast("Learned picks forgotten");
    } catch (err) {
      toast(err.message, "error");
    }
  } }, "Forget learned picks");
  const drawCount = () => {
    const learned = prefList.filter((p) => p.source === "learned").length;
    countEl.textContent = `${prefList.length} preference${prefList.length === 1 ? "" : "s"} (${learned} learned from cart picks, ${prefList.length - learned} added by you)`;
    learnedBtn.disabled = !learned;
  };
  drawCount();
  const prefCard = h(
    "div",
    { class: "card" },
    h("h3", {}, "Kroger product preferences"),
    h("p", { class: "muted small" }, "Pin your preferred products or add brand hints per ingredient on the Preferences tab. Products you send to the cart are learned automatically and pre-selected next time. ", h("b", {}, countEl)),
    h("div", { class: "row" }, h("button", { class: "btn", onclick: () => ctx.navigate("preferences") }, "Manage preferences"), learnedBtn),
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

  container.append(staplesCard, krogerCard, prefCard, accountCard);
}
