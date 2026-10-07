// GET /api/jobs/:id - poll a background job.
import { json, fail } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { getJob } from "../lib/jobs.mjs";

export default protectedHandler(async (req, context) => {
  const job = await getJob(context.params?.id);
  if (!job) return fail("Job not found", 404);
  return json({ job: { id: job.id, type: job.type, status: job.status, result: job.result, error: job.error, createdAt: job.createdAt } });
});

export const config = { path: "/api/jobs/:id" };
