// App shell: session check, hash router, tab bar, share-target + OAuth return handling.
import { api } from "./api.js";
import { toast, extractUrl } from "./util.js";
import * as library from "./views/library.js";
import * as week from "./views/week.js";
import * as grocery from "./views/grocery.js";
import * as settings from "./views/settings.js";

const VIEWS = { library, week, grocery, settings };
const TITLES = { library: "Library", week: "This Week", grocery: "Grocery List", settings: "Settings" };

const viewEl = document.getElementById("view");
const titleEl = document.getElementById("page-title");
const actionsEl = document.getElementById("topbar-actions");

let pendingShare = null;
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

async function start() {
  handleEntryParams();
  try {
    await api("/api/session"); // redirects to /login.html on 401
  } catch {
    return;
  }
  window.addEventListener("hashchange", route);
  await route();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
}

start();
