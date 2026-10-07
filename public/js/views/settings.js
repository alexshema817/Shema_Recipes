// Settings: pantry staples, Kroger store + connection, product preferences summary, site importer, sign out.
import { api } from "../api.js";
import { h, toast, confirmDialog } from "../util.js";
import { connectKroger, chooseStoreDialog } from "./kroger-ui.js";
import { buildBookmarklet, buildShortcutScript } from "../importer.js";

/** Copies text to the clipboard; when that is blocked, reveals it selected in a readonly textarea. */
async function copyCode(text, box) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied", "ok");
  } catch {
    box.hidden = false;
    box.value = text;
    box.focus();
    box.select();
    toast("Clipboard blocked - the code is selected below, copy it from there.", "error", 5000);
  }
}

function steps(summary, items) {
  return h("details", { class: "help" }, h("summary", {}, summary), h("ol", {}, items.map((s) => h("li", {}, s))));
}

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
  const drawCount = () => {
    countEl.textContent = `${prefList.length} preference${prefList.length === 1 ? "" : "s"}`;
  };
  drawCount();
  const prefCard = h(
    "div",
    { class: "card" },
    h("h3", {}, "Kroger product preferences"),
    h("p", { class: "muted small" }, "Pin your preferred products or add brand hints per ingredient on the Preferences tab. Everything else is matched to the lowest unit price. ", h("b", {}, countEl)),
    h("div", { class: "row" }, h("button", { class: "btn", onclick: () => ctx.navigate("preferences") }, "Manage preferences")),
  );

  // ---- "Send to Recipes" importer (bookmarklet + iOS Shortcut)
  const bookmarklet = buildBookmarklet();
  const shortcutScript = buildShortcutScript();
  const codeBox = h("textarea", { class: "code", readonly: true, rows: 4, hidden: true, spellcheck: false, "aria-label": "Importer code" });
  const importCard = h(
    "div",
    { class: "card" },
    h("h3", {}, "Import from any recipe site"),
    h("p", { class: "muted small" }, "Some sites (Allrecipes, Serious Eats and others) block this app's server but open fine in your browser. The \"Send to Recipes\" bookmarklet reads the recipe right there in your browser and opens it here for review - no server fetch, no account access. Copy the code once, then follow the setup for your phone."),
    h(
      "div",
      { class: "row" },
      h("button", { class: "btn primary", onclick: () => copyCode(bookmarklet, codeBox) }, "Copy bookmarklet"),
      h("button", { class: "btn", onclick: () => copyCode(shortcutScript, codeBox) }, "Copy Shortcut script"),
    ),
    codeBox,
    steps("iPhone Safari bookmark", [
      "Tap \"Copy bookmarklet\" above.",
      "In Safari, bookmark any page (Share, then Add Bookmark) and name it \"Send to Recipes\".",
      "Open Bookmarks, tap Edit, tap the new bookmark, replace its address with the copied code, and tap Done.",
      "On a recipe page, open Bookmarks and tap \"Send to Recipes\".",
    ]),
    steps("Android Chrome", [
      "Tap \"Copy bookmarklet\" above.",
      "In Chrome, bookmark any page (menu, star) and name it \"Send to Recipes\".",
      "Open Bookmarks, tap the bookmark's menu, choose Edit, and replace its URL with the copied code.",
      "On a recipe page, type \"Send to Recipes\" in the address bar and tap the bookmark in the suggestions. Chrome will not run it from the bookmarks menu.",
    ]),
    steps("iOS Shortcut (in Safari's Share menu)", [
      "Tap \"Copy Shortcut script\" above.",
      "One-time: in the iPhone Settings app, go to Apps, then Shortcuts, then Advanced, and turn on \"Allow Running Scripts\".",
      "In the Shortcuts app, create a new Shortcut and name it \"Send to Recipes\".",
      "Open its details (the i button): turn on \"Show in Share Sheet\" and, under Share Sheet Types, keep only \"Safari web pages\".",
      "Add the action \"Run JavaScript on Web Page\" (input: Shortcut Input) and paste the copied script, replacing the sample code.",
      "Add the action \"Open URLs\" and set its input to the result of the JavaScript action.",
      "On a recipe page, tap Share and choose \"Send to Recipes\".",
    ]),
    h("p", { class: "muted small", style: { marginTop: "8px" } }, "The page's structured recipe data is read directly; otherwise the page text is sent to the AI parser (counts against the daily AI limit). Review before saving, as always."),
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

  container.append(staplesCard, krogerCard, prefCard, importCard, accountCard);
}
