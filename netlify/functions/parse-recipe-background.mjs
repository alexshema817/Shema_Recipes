// Background function (returns 202 immediately, runs up to 15 min).
// POST /api/parse-background  { jobId, text, sourceUrl }
// Sends the reduced text to Claude and writes the result to jobs/{jobId}.
import { requireSession } from "../lib/auth.mjs";
import { readBody } from "../lib/http.mjs";
import { getJob, updateJob } from "../lib/jobs.mjs";
import { extractRecipeWithAI } from "../lib/ai.mjs";

export default async (req) => {
  const denied = requireSession(req);
  if (denied) return denied;
  const body = await readBody(req);
  const jobId = body?.jobId;
  if (!jobId) return new Response("jobId required", { status: 400 });
  const job = await getJob(jobId);
  if (!job || job.type !== "parse-recipe") return new Response("Unknown job", { status: 404 });
  if (job.status !== "pending") return new Response("Job already started", { status: 409 });

  await updateJob(jobId, { status: "running" });
  try {
    const text = String(body.text || "");
    if (text.trim().length < 20) throw new Error("No text to parse");
    const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : job.params?.sourceUrl || "";
    const recipe = await extractRecipeWithAI(text, sourceUrl);
    await updateJob(jobId, { status: "done", result: { recipe, method: "ai" }, error: null });
  } catch (err) {
    console.error("parse-recipe-background failed:", err);
    await updateJob(jobId, { status: "error", error: err?.message || "Parsing failed" });
  }
  return new Response(null, { status: 202 });
};

export const config = { path: "/api/parse-background", background: true };
