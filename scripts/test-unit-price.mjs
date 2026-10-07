// Unit tests for netlify/lib/unit-price.mjs. Run: npm run test:unit-price
import { parseSize, unitPriceOf, unitPriceLabel, rankByUnitPrice } from "../netlify/lib/unit-price.mjs";

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`ok    ${name}`);
  } else {
    failed++;
    console.log(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`);
  }
}

const r2 = (x) => (x == null ? null : Math.round(x * 1000) / 1000);
const size = (s) => {
  const p = parseSize(s);
  return p && { dim: p.dim, qty: r2(p.qty) };
};

console.log("# parseSize");
check("half gallon", size("1/2 gal"), { dim: "volume", qty: 64 });
check("gallon", size("1 gal"), { dim: "volume", qty: 128 });
check("fl oz beats oz", size("64 fl oz"), { dim: "volume", qty: 64 });
check("oz is weight", size("16 oz"), { dim: "weight", qty: 16 });
check("pounds", size("2 lb"), { dim: "weight", qty: 32 });
check("count", size("24 ct"), { dim: "count", qty: 24 });
check("dozen", size("1 dozen"), { dim: "count", qty: 12 });
check("multipack fl oz", size("6 ct / 12 fl oz"), { dim: "volume", qty: 72 });
check("multipack x", size("12 x 12 fl oz"), { dim: "volume", qty: 144 });
check("liters", size("1.5 l"), { dim: "volume", qty: 50.721 });
check("grams", size("500 g"), { dim: "weight", qty: 17.637 });
check("mixed fraction", size("1 1/2 lb"), { dim: "weight", qty: 24 });
check("unparseable", size("family size"), null);
check("empty", size(""), null);

console.log("\n# unitPriceOf");
check("milk per fl oz", r2(unitPriceOf({ price: 5.99, size: "1/2 gal" }).value), 0.094);
check("eggs per ct", r2(unitPriceOf({ price: 6.79, size: "24 ct" }).value), 0.283);
check("sold by weight is per lb", unitPriceOf({ price: 3.2, size: "", soldBy: "WEIGHT" }), { value: 0.2, unit: "oz", dim: "weight" });
check("no price", unitPriceOf({ price: null, size: "1 gal" }), null);
check("label", unitPriceLabel({ value: 0.0936, unit: "fl oz" }), "$0.094/fl oz");
check("label cents", unitPriceLabel({ value: 0.283, unit: "ct" }), "$0.28/ct");

console.log("\n# rankByUnitPrice");
const ids = (list) => list.map((p) => p.id);
check(
  "cheapest per unit first, bigger pack wins",
  ids(rankByUnitPrice([
    { id: "half", price: 2.5, size: "1/2 gal" },
    { id: "gal", price: 3.5, size: "1 gal" },
    { id: "quart", price: 1.5, size: "1 qt" },
  ])),
  ["gal", "half", "quart"],
);
check(
  "other dimensions and unknown sizes go after",
  ids(rankByUnitPrice([
    { id: "unknown", price: 1, size: "family size" },
    { id: "oz16", price: 4, size: "16 oz" },
    { id: "ct", price: 1, size: "1 ct" },
    { id: "oz8", price: 1.5, size: "8 oz" },
  ])),
  ["oz8", "oz16", "ct", "unknown"],
);
check("no unit prices keeps order", ids(rankByUnitPrice([{ id: "a", price: null, size: "" }, { id: "b", price: 1, size: "?" }])), ["a", "b"]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
