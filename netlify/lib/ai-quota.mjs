// Daily cap on Anthropic API calls, so a stolen login can't drain the credit
// balance. Counted in Blobs (`ai-usage`) per US Eastern calendar day.
// Override the limit with AI_DAILY_LIMIT; 0 disables AI calls entirely.
import { KEYS, readJSON, writeJSON } from "./blobs.mjs";

export const DEFAULT_DAILY_LIMIT = 30;
const TIME_ZONE = "America/New_York";

export function dailyLimit() {
  const n = Number.parseInt(process.env.AI_DAILY_LIMIT ?? "", 10);
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_DAILY_LIMIT;
}

/** YYYY-MM-DD for the given time in US Eastern. */
export function dayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Pure: given stored usage, returns { allowed, next } for one more call. */
export function nextUsage(stored, day, limit) {
  const count = stored?.day === day ? Number(stored.count) || 0 : 0;
  if (count >= limit) return { allowed: false, next: { day, count } };
  return { allowed: true, next: { day, count: count + 1 } };
}

/** Records one AI call or throws when today's limit is used up. */
export async function consumeAiQuota(now = new Date()) {
  const limit = dailyLimit();
  const { allowed, next } = nextUsage(await readJSON(KEYS.AI_USAGE, null), dayKey(now), limit);
  if (!allowed) {
    const err = new Error(`Daily AI limit reached (${limit} calls). It resets at midnight Eastern - or paste and edit the recipe by hand.`);
    err.httpStatus = 429;
    throw err;
  }
  await writeJSON(KEYS.AI_USAGE, next);
  return { used: next.count, limit };
}

export async function aiUsageToday(now = new Date()) {
  const stored = await readJSON(KEYS.AI_USAGE, null);
  const day = dayKey(now);
  return { used: stored?.day === day ? Number(stored.count) || 0 : 0, limit: dailyLimit() };
}
