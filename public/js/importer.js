// "Send to Recipes" importer: a script that runs on a third-party recipe page in
// the user's own browser (bookmarklet or iOS Shortcut), collects the page's
// schema.org JSON-LD (or its readable text), and opens this app with the data in
// the URL hash (#import=<base64url JSON>). Used for sites that block server-side
// fetches. This module is plain ESM with no DOM access at import time, so the
// same file is imported by the Settings view and by scripts/test-import.mjs.

export const APP_ORIGIN = "https://shema-recipes.netlify.app";
export const IMPORT_HASH_PREFIX = "#import=";
export const MAX_JSONLD_CHARS = 60000;
export const MAX_TEXT_CHARS = 12000;

/**
 * The importer itself. Stringified with String(importer) to build the two
 * artifacts, so keep it ES5-ish (old mobile WebViews), self-contained (no
 * references to module scope), and free of `//` comments except at line start.
 * `finish(url)` receives the app URL to open; `origin` is the app origin.
 */
export function importer(finish, origin, maxLd, maxText) {
  try {
    var ld = [];
    var total = 0;
    var scripts = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var s = scripts[i].textContent || "";
      if (!/recipe/i.test(s)) continue;
      if (total + s.length > maxLd) continue;
      ld.push(s);
      total += s.length;
    }
    var text = "";
    if (!ld.length) {
      var picks = ['[itemtype*="Recipe"]', "article", "main"];
      for (var p = 0; p < picks.length && !text; p++) {
        var el = document.querySelector(picks[p]);
        var t = el && el.innerText ? el.innerText : "";
        if (t.replace(/\s+/g, " ").length >= 400) text = t;
      }
      if (!text) text = document.body.innerText || "";
      text = text.replace(/[ \t\u00a0]+/g, " ").replace(/\s*\n\s*/g, "\n").trim().slice(0, maxText);
    }
    var json = JSON.stringify({ v: 1, url: location.href, title: document.title, jsonld: ld, text: text });
    var bytes = new TextEncoder().encode(json);
    var bin = "";
    for (var j = 0; j < bytes.length; j++) bin += String.fromCharCode(bytes[j]);
    var b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    finish(origin + "/#import=" + b64);
  } catch (e) {
    alert("Send to Recipes failed: " + (e && e.message ? e.message : e));
  }
}

/** One-line source of the importer: line comments removed, whitespace collapsed. */
export function importerSource() {
  return String(importer)
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function invocation(finishSource) {
  return `(${importerSource()})(${finishSource},${JSON.stringify(APP_ORIGIN)},${MAX_JSONLD_CHARS},${MAX_TEXT_CHARS})`;
}

/**
 * javascript: URL for a bookmark. Navigates with location.href (not window.open)
 * so popup blockers never interfere. `%` and `#` are percent-encoded because a
 * javascript: URL is percent-decoded before it runs and `#` would start a fragment.
 */
export function buildBookmarklet() {
  const code = invocation("function(u){location.href=u}");
  return "javascript:" + code.replace(/%/g, "%25").replace(/#/g, "%23");
}

/** Script for an iOS Shortcuts "Run JavaScript on Web Page" action; the result feeds an "Open URLs" action. */
export function buildShortcutScript() {
  return `// Send to Recipes - paste into "Run JavaScript on Web Page"\n${invocation("function(u){completion(u)}")};\n`;
}

// ---------------------------------------------------------------------------
// Payload encoding (mirrors the importer) and decoding (used by app.js)
// ---------------------------------------------------------------------------

export function encodeImportPayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url -> UTF-8 JSON -> { v, url, title, jsonld, text }. Throws on malformed input. */
export function decodeImportPayload(encoded) {
  const s = String(encoded || "").trim().replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (!s) throw new Error("Empty import payload");
  const bin = atob(s + "=".repeat((4 - (s.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Import payload is not an object");
  return {
    v: data.v,
    url: typeof data.url === "string" ? data.url : "",
    title: typeof data.title === "string" ? data.title : "",
    jsonld: Array.isArray(data.jsonld) ? data.jsonld.filter((b) => typeof b === "string") : [],
    text: typeof data.text === "string" ? data.text : "",
  };
}
