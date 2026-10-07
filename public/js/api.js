// Fetch helpers for the app's Netlify Functions.

export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) {
    location.replace("/login.html");
    throw new Error("Not signed in");
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || res.statusText };
  }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.code = data.code;
    err.data = data;
    throw err;
  }
  return data;
}

/** Fires a background function. Netlify answers 202 immediately. */
export async function startBackground(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  if (res.status === 401) {
    location.replace("/login.html");
    throw new Error("Not signed in");
  }
  if (!res.ok && res.status !== 202) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Could not start background job (${res.status})`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls /api/jobs/:id until done or error. Resolves with job.result. */
export async function pollJob(jobId, { intervalMs = 2500, timeoutMs = 11 * 60 * 1000, onTick } = {}) {
  const start = Date.now();
  let interval = intervalMs;
  while (Date.now() - start < timeoutMs) {
    const { job } = await api(`/api/jobs/${jobId}`);
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error || "The background job failed");
    onTick?.(job, Date.now() - start);
    await sleep(interval);
    interval = Math.min(6000, interval + 250);
  }
  throw new Error("Timed out waiting for the result. Please try again.");
}
