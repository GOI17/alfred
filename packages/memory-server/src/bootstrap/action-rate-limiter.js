// Rate limiter for Custom GPT Actions (read + write against /memories, /search).
//
// Policy: 100 successful OR failed requests per API key per rolling 60 minutes.
// If exceeded, the next call returns rate_limited and the server replies 429
// with Retry-After header.
//
// Keyed by API key (not IP) because the GPT runs server-side at OpenAI;
// hundreds of users behind a Custom GPT would all look like one IP. The
// right identity to throttle is the tenant's API key.
//
// Backed by the alfred_registry's action_attempts table so the throttle
// state survives process restarts and is shared across instances.

import { randomUUID } from "node:crypto";

const WINDOW_MS = 60 * 60 * 1000; // 60 minutes
const MAX_ATTEMPTS = 100;

const VALID_RESULTS = new Set([
  "success", "validation_error", "unauthorized", "rate_limited", "not_found", "internal_error"
]);

function nowIso() { return new Date().toISOString(); }

function secondsUntil(oldestIso, clock) {
  const retry = new Date(oldestIso).getTime() + WINDOW_MS - clock();
  return Math.max(1, Math.ceil(retry / 1000));
}

export function createActionRateLimiter({ registry, clock = () => Date.now(), maxAttempts = MAX_ATTEMPTS, windowMs = WINDOW_MS } = {}) {
  if (!registry) throw new TypeError("createActionRateLimiter requires a registry");
  // Accept either flat or nested-under-`actions` contract (registry shape
  // varies by version: pre-v0.4.1 had flat, v0.4.1+ scopes them under .actions).
  const actions = (typeof registry.recordActionAttempt === "function" && typeof registry.countActionAttempts === "function")
    ? registry
    : registry.actions;
  if (!actions || typeof actions.recordActionAttempt !== "function") {
    throw new TypeError("registry must implement recordActionAttempt(input) (top-level or under .actions)");
  }
  if (typeof actions.countActionAttempts !== "function") {
    throw new TypeError("registry must implement countActionAttempts({ apiKeyHash, since })");
  }
  if (typeof actions.oldestActionAttemptInWindow !== "function") {
    throw new TypeError("registry must implement oldestActionAttemptInWindow({ apiKeyHash, since })");
  }

  return {
    maxAttempts,
    windowMs,

    async check({ apiKeyHash }) {
      if (typeof apiKeyHash !== "string" || apiKeyHash === "") {
        return { allowed: false, reason: "key_missing" };
      }
      const since = new Date(clock() - windowMs).toISOString();
      const count = await actions.countActionAttempts({ apiKeyHash, since });
      if (count >= maxAttempts) {
        const oldest = await actions.oldestActionAttemptInWindow({ apiKeyHash, since });
        const retryAfter = oldest ? secondsUntil(oldest.attempted_at, clock) : Math.ceil(windowMs / 1000);
        return { allowed: false, reason: "rate_limited", retryAfterSeconds: retryAfter };
      }
      return { allowed: true, remaining: maxAttempts - count - 1 };
    },

    record({ apiKeyHash, endpoint, method, result, errorCode }) {
      if (!VALID_RESULTS.has(result)) {
        throw new TypeError(`Invalid result: ${result}`);
      }
      return actions.recordActionAttempt({
        id: `aatt_${randomUUID().replace(/-/g, "")}`,
        api_key_hash: apiKeyHash,
        attempted_at: nowIso(),
        endpoint: endpoint ?? null,
        method: method ?? null,
        result,
        error_code: errorCode ?? null
      });
    }
  };
}
