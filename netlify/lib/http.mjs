// Small helpers for Netlify Functions v2 (web Request/Response).

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export function fail(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, status);
}

export async function readBody(req) {
  try {
    const text = await req.text();
    if (!text) return {};
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function redirect(location, status = 302, headers = {}) {
  return new Response(null, { status, headers: { location, "cache-control": "no-store", ...headers } });
}

export function methodNotAllowed(allowed) {
  return json({ error: `Method not allowed. Use ${allowed.join(", ")}.` }, 405, { allow: allowed.join(", ") });
}
