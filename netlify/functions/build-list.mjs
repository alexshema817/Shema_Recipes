// POST /api/build-list  { includeStaples?: boolean }
// Validates there is something to build, creates a job, and returns { jobId }.
// The frontend then POSTs { jobId } to /api/build-list-background and polls /api/jobs/:id.
import { KEYS, readJSON } from "../lib/blobs.mjs";
import { json, fail, readBody, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { createJob } from "../lib/jobs.mjs";

export default protectedHandler(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const body = (await readBody(req)) || {};
  const week = (await readJSON(KEYS.WEEK, null)) || { items: [] };
  if (!Array.isArray(week.items) || week.items.length === 0) return fail("Flag at least one recipe for This Week first.", 422);
  const job = await createJob("build-list", { includeStaples: !!body.includeStaples });
  return json({ jobId: job.id });
});

export const config = { path: "/api/build-list" };
