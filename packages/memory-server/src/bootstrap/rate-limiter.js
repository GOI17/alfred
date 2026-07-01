// Rate limiter for POST /console/api/bootstrap.
//
// Stores attempts in the alfred_registry's bootstrap_attempts table so the
// throttle state survives process restarts and is shared across instances.
//
// Policy: 5 successful OR failed attempts per IP per rolling 60 minutes.
// If exceeded, the next call returns rate_limited and the server replies 429.
//
// The limit is intentionally generous (5/hour) because v0.3.1 has no CAPTCHA
// and no email verification. A determined attacker with rotating IPs can
// bypass it; that's accepted risk for v0.3.1. v0.4 will add Turnstile +
// email magic links.

import { randomUUID } from "node:crypto";

const WINDOW_MS = 60 * 60 * 1000;          // 60 minutes
const MAX_ATTEMPTS = 5;

const VALID_RESULTS = new Set([
  "success", "validation_error", "rate_limited", "config_error", "internal_error"
]);

function nowIso() { return new Date().toISOString(); }

function minutesBetween(a, b) {
  return Math.ceil((new Date(a).getTime() - new Date(b).getTime()) / 60000);
}

export function createRateLimiter({ registry, clock = () => Date.now() } = {}) {
  if (!registry) throw new TypeError("createRateLimiter requires a registry");
  if (typeof registry.recordBootstrapAttempt !== "function") {
    throw new TypeError("registry must implement recordBootstrapAttempt(input)");
  }
  if (typeof registry.countBootstrapAttempts !== "function") {
    throw new TypeError("registry must implement countBootstrapAttempts({ ip, since })");
  }

  return {
    maxAttempts: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,

    async check({ ip }) {
      if (typeof ip !== "string" || ip === "") {
        return { allowed: false, reason: "ip_missing" };
      }
      const since = new Date(clock() - WINDOW_MS).toISOString();
      const count = await registry.countBootstrapAttempts({ ip, since });
      if (count >= MAX_ATTEMPTS) {
        // Find the oldest attempt in the window to compute retry_after.
        const oldest = await registry.oldestBootstrapAttemptInWindow({ ip, since });
        const retryAfter = oldest ? minutesBetween(new Date(clock() + WINDOW_MS).toISOString(), oldest.attempted_at) : 60;
        return { allowed: false, reason: "rate_limited", retryAfterMinutes: Math.max(1, retryAfter) };
      }
      return { allowed: true, remaining: MAX_ATTEMPTS - count - 1 };
    },

    async record({ ip, displayName, kind, result, tenantId, errorCode }) {
      if (!VALID_RESULTS.has(result)) {
        throw new TypeError(`Invalid result: ${result}`);
      }
      await registry.recordBootstrapAttempt({
        id: `batt_${randomUUID().replace(/-/g, "")}`,
        ip,
        attempted_at: nowIso(),
        display_name: displayName ?? null,
        kind: kind ?? null,
        result,
        tenant_id: tenantId ?? null,
        error_code: errorCode ?? null
      });
    }
  };
}
