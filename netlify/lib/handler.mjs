// Wraps a function handler with session enforcement and uniform error output.
import { requireSession } from "./auth.mjs";
import { fail } from "./http.mjs";

export function protectedHandler(fn) {
  return async (req, context) => {
    const denied = requireSession(req);
    if (denied) return denied;
    try {
      return await fn(req, context);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function publicHandler(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err) {
  console.error(err);
  const message = err?.message || "Unexpected error";
  if (err?.code === "KROGER_NOT_CONNECTED") return fail(message, 409, { code: err.code });
  const status = Number.isInteger(err?.httpStatus) ? err.httpStatus : 500;
  return fail(message, status);
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.httpStatus = status;
  }
}
