// Kroger Public API client: OAuth2 (authorization code + refresh, client
// credentials), locations, products, cart. Tokens live in Netlify Blobs.
import { KEYS, readJSON, writeJSON, remove } from "./blobs.mjs";

export const USER_SCOPES = "cart.basic:write product.compact profile.compact";
export const CLIENT_SCOPES = "product.compact";

export class KrogerNotConnected extends Error {
  constructor(message = "Kroger is not connected. Use \"Connect Kroger\" first.") {
    super(message);
    this.code = "KROGER_NOT_CONNECTED";
  }
}

export function krogerConfig() {
  const clientId = process.env.KROGER_CLIENT_ID;
  const clientSecret = process.env.KROGER_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("KROGER_CLIENT_ID / KROGER_CLIENT_SECRET are not set");
  let base = (process.env.KROGER_API_BASE || "https://api.kroger.com/v1").trim().replace(/\/+$/, "");
  if (!/\/v1$/i.test(base)) base += "/v1";
  const tokenUrl = (process.env.KROGER_TOKEN_URL || `${base}/connect/oauth2/token`).trim();
  const authorizeUrl = (process.env.KROGER_AUTHORIZE_URL || tokenUrl.replace(/\/token\/?$/i, "/authorize")).trim();
  const redirectUri = (process.env.KROGER_REDIRECT_URI || "").trim();
  return { clientId, clientSecret, base, tokenUrl, authorizeUrl, redirectUri };
}

function basicAuth(cfg) {
  return "Basic " + Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64");
}

async function tokenRequest(params) {
  const cfg = krogerConfig();
  const res = await fetch(cfg.tokenUrl, {
    method: "POST",
    headers: {
      authorization: basicAuth(cfg),
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Kroger token request failed (${res.status}): ${data.error_description || data.error || res.statusText}`);
    err.status = res.status;
    err.krogerError = data.error;
    throw err;
  }
  return data;
}

export function buildAuthorizeUrl(state) {
  const cfg = krogerConfig();
  if (!cfg.redirectUri) throw new Error("KROGER_REDIRECT_URI is not set");
  const u = new URL(cfg.authorizeUrl);
  u.searchParams.set("scope", USER_SCOPES);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

async function saveUserTokens(data, previous = null) {
  const tokens = {
    accessToken: data.access_token,
    // Refresh tokens may rotate - always keep the newest one we were given.
    refreshToken: data.refresh_token || previous?.refreshToken || null,
    expiresAt: Date.now() + (Number(data.expires_in) || 1800) * 1000 - 60_000,
    scope: data.scope || USER_SCOPES,
    connectedAt: previous?.connectedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await writeJSON(KEYS.KROGER_TOKENS, tokens);
  return tokens;
}

export async function exchangeCode(code) {
  const cfg = krogerConfig();
  const data = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri });
  return saveUserTokens(data);
}

export async function getUserTokens() {
  return readJSON(KEYS.KROGER_TOKENS, null);
}

export async function disconnect() {
  await remove(KEYS.KROGER_TOKENS);
}

/** Returns a valid user access token, refreshing (and persisting the rotated refresh token) when expired. */
export async function getUserAccessToken() {
  const t = await getUserTokens();
  if (!t || (!t.accessToken && !t.refreshToken)) throw new KrogerNotConnected();
  if (t.accessToken && t.expiresAt > Date.now()) return t.accessToken;
  if (!t.refreshToken) throw new KrogerNotConnected();
  let data;
  try {
    data = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refreshToken });
  } catch (err) {
    if (err.status === 400 || err.status === 401) {
      await remove(KEYS.KROGER_TOKENS);
      throw new KrogerNotConnected("Your Kroger connection expired. Please connect Kroger again.");
    }
    throw err;
  }
  const saved = await saveUserTokens(data, t);
  return saved.accessToken;
}

/** App-level token (client credentials) for product/location search - no user login needed. */
export async function getClientToken() {
  const cached = await readJSON(KEYS.KROGER_CLIENT_TOKEN, null);
  if (cached?.accessToken && cached.expiresAt > Date.now()) return cached.accessToken;
  const data = await tokenRequest({ grant_type: "client_credentials", scope: CLIENT_SCOPES });
  const tok = { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 1800) * 1000 - 60_000 };
  await writeJSON(KEYS.KROGER_CLIENT_TOKEN, tok);
  return tok.accessToken;
}

async function apiRequest(path, { token, method = "GET", body } = {}) {
  const cfg = krogerConfig();
  const res = await fetch(`${cfg.base}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const reason = data?.errors?.reason || data?.error_description || data?.error || data?.message || res.statusText;
    const err = new Error(`Kroger API ${method} ${path.split("?")[0]} failed (${res.status}): ${reason}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function searchLocations(zip, limit = 10) {
  const z = String(zip || "").replace(/\D/g, "").slice(0, 5);
  if (z.length !== 5) throw new Error("Enter a 5-digit ZIP code");
  const token = await getClientToken();
  const q = new URLSearchParams({ "filter.zipCode.near": z, "filter.limit": String(limit) });
  const data = await apiRequest(`/locations?${q}`, { token });
  return (data?.data || []).map((l) => ({
    locationId: l.locationId,
    name: l.name,
    chain: l.chain,
    address: [l.address?.addressLine1, l.address?.city, l.address?.state, l.address?.zipCode].filter(Boolean).join(", "),
  }));
}

/** Key used for the ingredient-name -> UPC memory map. */
export function normalizeName(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Kroger's filter.term: 3+ chars, at most 8 words, letters/numbers only. */
export function cleanSearchTerm(name) {
  const words = String(name || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  let term = words.join(" ");
  if (term.length < 3) term = (term + "   ").slice(0, 3).trim();
  return term;
}

function mapProduct(p) {
  const item = (p.items || [])[0] || {};
  const price = item.price || {};
  const regular = price.regular ?? null;
  const promo = price.promo && price.promo > 0 ? price.promo : null;
  return {
    productId: p.productId,
    upc: p.upc,
    description: p.description || "",
    brand: p.brand || "",
    size: item.size || "",
    price: promo ?? regular,
    regularPrice: regular,
    promoPrice: promo,
    soldBy: item.soldBy || "",
  };
}

export async function searchProducts(term, locationId, limit = 3) {
  const token = await getClientToken();
  const q = new URLSearchParams({ "filter.term": term, "filter.limit": String(limit) });
  if (locationId) q.set("filter.locationId", locationId);
  const data = await apiRequest(`/products?${q}`, { token });
  return (data?.data || []).map(mapProduct);
}

/** Kroger productIds are 13 digits; a 12-digit UPC-A is the same code without the leading 0. */
export function normalizeProductId(id) {
  const digits = String(id || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 12 ? "0" + digits : digits;
}

/**
 * GET /v1/products/{id} (product.compact scope) for one product by productId/UPC,
 * falling back to a term search on the digits. Returns null when nothing is found.
 */
export async function getProduct(id, locationId) {
  const pid = normalizeProductId(id);
  if (!/^\d{8,14}$/.test(pid)) return null;
  const token = await getClientToken();
  const loc = locationId ? `?${new URLSearchParams({ "filter.locationId": locationId })}` : "";
  try {
    const data = await apiRequest(`/products/${pid}${loc}`, { token });
    if (data?.data?.productId) return mapProduct(data.data);
  } catch (err) {
    if (err.status && err.status !== 404 && err.status !== 400) throw err;
  }
  const found = await searchProducts(pid, locationId, 5).catch(() => []);
  return found.find((p) => normalizeProductId(p.upc) === pid || normalizeProductId(p.productId) === pid) || null;
}

/** PUT /v1/cart/add with [{ upc, quantity, modality }]. Returns true on success (204). */
export async function addToCart(items) {
  const token = await getUserAccessToken();
  await apiRequest("/cart/add", { token, method: "PUT", body: { items } });
  return true;
}
