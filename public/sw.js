// Service worker: caches the app shell so the PWA installs and opens offline.
// API calls (/api/*, /.netlify/*) are never intercepted.
const CACHE = "recipes-shell-v4";
const SHELL = [
  "/",
  "/index.html",
  "/login.html",
  "/manifest.webmanifest",
  "/css/app.css",
  "/js/app.js",
  "/js/api.js",
  "/js/util.js",
  "/js/views/library.js",
  "/js/views/week.js",
  "/js/views/grocery.js",
  "/js/views/settings.js",
  "/js/views/preferences.js",
  "/js/views/kroger-ui.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => Promise.allSettled(SHELL.map((u) => cache.add(u)))).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/")) return;

  if (req.mode === "navigate") {
    // Network first; fall back to the cached shell (keeps /share working offline too).
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && url.pathname === "/") caches.open(CACHE).then((c) => c.put("/index.html", res.clone()));
          return res;
        })
        .catch(() => caches.match(url.pathname === "/login.html" ? "/login.html" : "/index.html")),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req)),
  );
});
