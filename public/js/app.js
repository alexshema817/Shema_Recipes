// App shell: session check, hash router, tab bar, share-target + importer + OAuth return handling.
import { api } from "./api.js";
import { toast, extractUrl } from "./util.js";
import { IMPORT_HASH_PREFIX, decodeImportPayload } from "./importer.js";
import * as library from "./views/library.js";
import * as week from "./views/week.js";
import * as grocery from "./views/grocery.js";
import * as preferences from "./views/preferences.js";
import * as settings from "./views/settings.js";

const VIEWS = { library, week, grocery, preferences, settings };
const TITLES = { library: "Library", week: "This Week", grocery: "Grocery List", preferences: "Preferences", settings: "Settings" };

const viewEl = document.getElementById("view");
const titleEl = document.getElementById("page-title");
const actionsEl = document.getElementById("topbar-actions");

const IMPORT_STASH_KEY = "rk_pending_import";

let pendingShare = null;
let pendingImportRaw = null;
let currentRender = 0;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [name, ...params] = raw.split("/").filter(Boolean);
  if (name === "recipe") return { view: "library", params: ["recipe", ...params] };
  return { view: VIEWS[name] ? name : "library", params };
}

export function navigate(hash) {
  if (location.hash === `#${hash}`) route();
  else location.hash = hash;
}

async function route() {
  const { view, params } = parseHash();
  const id = ++currentRender;
  document.querySelectorAll(".tabbar a").forEach((a) => a.classList.toggle("active", a.dataset.tab === view));
  titleEl.textContent = TITLES[view];
  actionsEl.replaceChildren();
  viewEl.replaceChildren();
  window.scrollTo(0, 0);
  const ctx = {
    params,
    navigate,
    setTitle: (t) => (titleEl.textContent = t),
    setActions: (...nodes) => actionsEl.replaceChildren(...nodes.filter(Boolean)),
    isCurrent: () => id === currentRender,
    takePendingShare: () => {
      const s = pendingShare;
      pendingShare = null;
      return s;
    },
  };
  try {
    await VIEWS[view].render(viewEl, ctx);
  } catch (err) {
    if (ctx.isCurrent()) {
      viewEl.replaceChildren();
      const p = document.createElement("p");
      p.className = "error";
      p.textContent = err.message || "Something went wrong";
      viewEl.append(p);
    }
  }
}

function handleEntryParams() {
  const params = new URLSearchParams(location.search);
  let targetHash = null;

  if (location.pathname === "/share" || params.has("url") || params.has("text") || params.has("title")) {
    const url = params.get("url") || extractUrl(params.get("text")) || extractUrl(params.get("title")) || "";
    const text = !url ? params.get("text") || "" : "";
    if (url || text) pendingShare = { url, text };
    targetHash = "library";
  }

  const kroger = params.get("kroger");
  if (kroger === "connected") {
    toast("Kroger connected.", "ok");
    targetHash = "grocery";
  } else if (kroger === "error") {
    toast(`Kroger connection failed: ${params.get("message") || "unknown error"}`, "error", 6000);
    targetHash = "grocery";
  }

  if (location.search || location.pathname !== "/") {
    const hash = targetHash ? `#${targetHash}` : location.hash || "#library";
    history.replaceState(null, "", `/${hash}`);
  } else if (targetHash) {
    location.hash = targetHash;
  }
}

/**
 * "Send to Recipes" bookmarklet / Shortcut lands on /#import=<base64url JSON>.
 * The payload is taken out of the URL bar immediately and stashed in
 * sessionStorage so it survives the /login.html round trip (api() redirects on
 * 401 and login.html comes back to "/"). It is consumed once, after the session
 * check, by takeStashedImport().
 */
function stashImportHash() {
  if (!location.hash.startsWith(IMPORT_HASH_PREFIX)) return;
  pendingImportRaw = location.hash.slice(IMPORT_HASH_PREFIX.length);
  try {
    sessionStorage.setItem(IMPORT_STASH_KEY, pendingImportRaw);
  } catch {}
  history.replaceState(null, "", "/#library");
}

function takeStashedImport() {
  let raw = pendingImportRaw;
  pendingImportRaw = null;
  try {
    raw = raw || sessionStorage.getItem(IMPORT_STASH_KEY);
    sessionStorage.removeItem(IMPORT_STASH_KEY);
  } catch {}
  if (!raw) return null;
  try {
    return decodeImportPayload(raw);
  } catch {
    toast("Could not read the recipe data sent from your browser. Try the bookmarklet again.", "error", 6000);
    return null;
  }
}

async function start() {
  stashImportHash();
  handleEntryParams();
  try {
    await api("/api/session"); // redirects to /login.html on 401
  } catch {
    return;
  }
  const imported = takeStashedImport();
  if (imported) {
    pendingShare = { import: imported };
    history.replaceState(null, "", "/#library");
  }
  window.addEventListener("hashchange", route);
  await route();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

start();
