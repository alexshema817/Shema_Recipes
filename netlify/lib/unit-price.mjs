// Unit price from a Kroger product's size string ("1/2 gal", "24 ct", "6 ct / 12 fl oz")
// so match results can be ranked cheapest-per-unit. Pure functions (see
// scripts/test-unit-price.mjs). Weight is compared per oz, volume per fl oz,
// count per item; products in different dimensions are never compared directly.

const UNITS = {
  // weight -> oz
  oz: ["weight", 1], ounce: ["weight", 1], ounces: ["weight", 1],
  lb: ["weight", 16], lbs: ["weight", 16], pound: ["weight", 16], pounds: ["weight", 16],
  g: ["weight", 0.035274], gram: ["weight", 0.035274], grams: ["weight", 0.035274],
  kg: ["weight", 35.274],
  // volume -> fl oz
  floz: ["volume", 1],
  gal: ["volume", 128], gallon: ["volume", 128], gallons: ["volume", 128],
  qt: ["volume", 32], quart: ["volume", 32], quarts: ["volume", 32],
  pt: ["volume", 16], pint: ["volume", 16], pints: ["volume", 16],
  l: ["volume", 33.814], lt: ["volume", 33.814], ltr: ["volume", 33.814], liter: ["volume", 33.814], liters: ["volume", 33.814], litre: ["volume", 33.814], litres: ["volume", 33.814],
  ml: ["volume", 0.033814],
  // count -> each
  ct: ["count", 1], count: ["count", 1], each: ["count", 1], ea: ["count", 1], pk: ["count", 1], pack: ["count", 1],
  dozen: ["count", 12], doz: ["count", 12],
};

export const DISPLAY_UNIT = { weight: "oz", volume: "fl oz", count: "ct" };

const NUM = String.raw`(\d+\s+\d+\/\d+|\d+\/\d+|\d*\.?\d+)`;
const UNIT = String.raw`(fl\.?\s*oz|[a-z]+)`;

function toNumber(s) {
  s = String(s).trim();
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : NaN;
  return Number(s);
}

function unitInfo(u) {
  const key = String(u).toLowerCase().replace(/[.\s]/g, "");
  return UNITS[key] || null;
}

/** Parses a size string into { dim, qty } in base units (oz, fl oz or count), or null. */
export function parseSize(size) {
  const s = String(size || "").toLowerCase().replace(/×/g, "x");
  if (!s.trim()) return null;

  // Multipacks: "6 ct / 12 fl oz", "12 x 12 fl oz", "4 pk / 16.9 fl oz" -> count x each.
  // A bare "/" needs a count word first so fractions like "1/2 gal" aren't read as packs.
  const multi = s.match(new RegExp(String.raw`(\d+)\s*(?:(?:ct|count|pk|pack)\s*[\/x]|x)\s*` + NUM + String.raw`\s*` + UNIT + String.raw`\b`));
  if (multi) {
    const info = unitInfo(multi[3]);
    const n = Number(multi[1]);
    const each = toNumber(multi[2]);
    if (info && info[0] !== "count" && n > 0 && each > 0) return { dim: info[0], qty: n * each * info[1] };
  }

  const one = s.match(new RegExp(NUM + String.raw`\s*` + UNIT + String.raw`\b`));
  if (one) {
    const info = unitInfo(one[2]);
    const n = toNumber(one[1]);
    if (info && n > 0) return { dim: info[0], qty: n * info[1] };
  }
  if (/\b(dozen|doz)\b/.test(s)) return { dim: "count", qty: 12 };
  return null;
}

/**
 * Unit price for a mapped product { price, size, soldBy }: { value, unit, dim } or null.
 * Items sold by weight are priced per lb by Kroger.
 */
export function unitPriceOf(product) {
  const price = Number(product?.price);
  if (product?.price == null || !Number.isFinite(price) || price <= 0) return null;
  let parsed = parseSize(product.size);
  if (String(product.soldBy || "").toUpperCase() === "WEIGHT") parsed = { dim: "weight", qty: 16 };
  if (!parsed || !(parsed.qty > 0)) return null;
  return { value: price / parsed.qty, unit: DISPLAY_UNIT[parsed.dim], dim: parsed.dim };
}

/** "$0.09/fl oz" style label (more decimals for very small unit prices). */
export function unitPriceLabel(up) {
  if (!up) return "";
  const v = up.value;
  const digits = v < 0.1 ? 3 : 2;
  return `$${v.toFixed(digits)}/${up.unit}`;
}

/**
 * Orders products cheapest-per-unit first. Only products sharing the most common
 * dimension (ties: the first result's) are compared; the rest follow in their
 * original order, products without a unit price last.
 */
export function rankByUnitPrice(products) {
  const list = products.map((p, i) => ({ p, i, up: p.unitPrice || unitPriceOf(p) }));
  const counts = {};
  for (const x of list) if (x.up) counts[x.up.dim] = (counts[x.up.dim] || 0) + 1;
  const firstDim = list.find((x) => x.up)?.up.dim;
  let dim = null;
  for (const [d, n] of Object.entries(counts)) if (!dim || n > counts[dim] || (n === counts[dim] && d === firstDim)) dim = d;
  const comparable = list.filter((x) => x.up && x.up.dim === dim).sort((a, b) => a.up.value - b.up.value || a.i - b.i);
  const rest = list.filter((x) => !(x.up && x.up.dim === dim)).sort((a, b) => (a.up ? 0 : 1) - (b.up ? 0 : 1) || a.i - b.i);
  return [...comparable, ...rest].map((x) => x.p);
}
