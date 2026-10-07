// POST /api/parse-import  { url, title, jsonld: [string], text }
// Receives what the "Send to Recipes" bookmarklet / iOS Shortcut collected in the
// user's browser (for sites that block server-side fetches). Responds exactly like
// /api/parse so the frontend's review + background-job flow is reused:
//   { status: "done", recipe, method: "jsonld" }
//   { status: "needs_ai", jobId, payload: { text, sourceUrl } }
import { fail, json, readBody, methodNotAllowed } from "../lib/http.mjs";
import { protectedHandler } from "../lib/handler.mjs";
import { decideImport } from "../lib/import.mjs";
import { createJob } from "../lib/jobs.mjs";

export default protectedHandler(async (req) => {
  if (req.method !== "POST") return methodNotAllowed(["POST"]);
  const body = await readBody(req);
  if (!body) return fail("Invalid JSON body");

  const decision = decideImport(body);
  if (decision.status === "done") return json({ status: "done", method: "jsonld", recipe: decision.recipe });
  if (decision.status === "needs_ai") {
    const job = await createJob("parse-recipe", { sourceUrl: decision.payload.sourceUrl });
    return json({ status: "needs_ai", jobId: job.id, payload: decision.payload });
  }
  return fail(decision.error, decision.httpStatus || 422);
});

export const config = { path: "/api/parse-import" };
