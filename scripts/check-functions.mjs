// Import smoke test: loads every function and lib module, checks each function
// exports a default handler and a config.path. Run: npm run check
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const fnDir = path.join(root, "netlify", "functions");
const libDir = path.join(root, "netlify", "lib");

let failed = 0;
const rows = [];

for (const file of readdirSync(libDir).filter((f) => f.endsWith(".mjs"))) {
  try {
    await import(pathToFileURL(path.join(libDir, file)).href);
    rows.push(["lib", file, "ok", ""]);
  } catch (err) {
    failed++;
    rows.push(["lib", file, "FAIL", err.message]);
  }
}

for (const file of readdirSync(fnDir).filter((f) => f.endsWith(".mjs"))) {
  try {
    const mod = await import(pathToFileURL(path.join(fnDir, file)).href);
    const problems = [];
    if (typeof mod.default !== "function") problems.push("no default export function");
    if (!mod.config?.path) problems.push("no config.path");
    if (file.endsWith("-background.mjs") && mod.config?.background !== true) problems.push("background function without config.background");
    if (problems.length) {
      failed++;
      rows.push(["function", file, "FAIL", problems.join("; ")]);
    } else {
      rows.push(["function", file, "ok", [].concat(mod.config.path).join(", ") + (mod.config.background ? " (background)" : "")]);
    }
  } catch (err) {
    failed++;
    rows.push(["function", file, "FAIL", err.message]);
  }
}

const w = Math.max(...rows.map((r) => r[1].length));
for (const [kind, file, status, info] of rows) console.log(`${kind.padEnd(8)} ${file.padEnd(w)}  ${status.padEnd(4)}  ${info}`);
console.log(failed ? `\n${failed} module(s) failed` : `\nAll ${rows.length} modules loaded`);
process.exit(failed ? 1 : 0);
