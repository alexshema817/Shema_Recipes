// Background job records in Blobs (jobs/{id}) polled by the frontend.
import { randomUUID } from "node:crypto";
import { KEYS, readJSON, writeJSON } from "./blobs.mjs";

export const JOB_TIMEOUT_MS = 12 * 60 * 1000;

export async function createJob(type, params = {}) {
  const id = randomUUID();
  const job = { id, type, status: "pending", params, result: null, error: null, createdAt: Date.now(), updatedAt: Date.now() };
  await writeJSON(KEYS.job(id), job);
  return job;
}

export async function getJob(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))) return null;
  const job = await readJSON(KEYS.job(id), null);
  if (!job) return null;
  if ((job.status === "pending" || job.status === "running") && Date.now() - job.createdAt > JOB_TIMEOUT_MS) {
    return { ...job, status: "error", error: "The job timed out. Please try again." };
  }
  return job;
}

export async function updateJob(id, patch) {
  const job = (await readJSON(KEYS.job(id), null)) || { id, createdAt: Date.now() };
  const next = { ...job, ...patch, updatedAt: Date.now() };
  await writeJSON(KEYS.job(id), next);
  return next;
}
