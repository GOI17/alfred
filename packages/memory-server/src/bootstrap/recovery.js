// Forgot-my-key recovery orchestrator.
//
// Flow:
//   1. POST /console/api/recover { email } -> server finds the tenant
//      whose most recent email_verification matches the email, generates
//      a 1-hour recovery token, and (if SMTP is configured) sends a
//      magic link with the new key.
//   2. GET /console/api/recover?token=... -> server validates the
//      token, finds the active key for the tenant, revokes it, issues
//      a new key, and returns the new key to the user.
//   3. The user is then unlocked with the new key.
//
// Rate-limited: 3 attempts per IP per hour (separate from the bootstrap
// rate limit because recovery is a different threat surface).

const RECOVERY_TTL_MS = 60 * 60 * 1000; // 1 hour
const RECOVERY_RATE_LIMIT = 3;
const RECOVERY_WINDOW_MS = 60 * 60 * 1000; // 60 minutes

export class RecoveryRateLimitedError extends Error {
  constructor(retryAfterMinutes) {
    super(`Too many recovery attempts. Try again in ${retryAfterMinutes} minute(s).`);
    this.name = "RecoveryRateLimitedError";
    this.code = "rate_limited";
    this.status = 429;
    this.retryAfterMinutes = retryAfterMinutes;
  }
}

export class RecoveryNotFoundError extends Error {
  constructor() {
    super("No tenant found for that email.");
    this.name = "RecoveryNotFoundError";
    this.code = "not_found";
    this.status = 404;
  }
}

export class RecoveryValidationError extends Error {
  constructor(details) {
    super("Recovery input is invalid.");
    this.name = "RecoveryValidationError";
    this.code = "validation_error";
    this.status = 400;
    this.details = details;
  }
}

export function createRecovery({ registry, userService, emailSender, baseUrl = "", now = () => Date.now(), clock = () => Date.now() } = {}) {
  if (!registry) throw new TypeError("createRecovery requires registry");
  if (!userService) throw new TypeError("createRecovery requires userService");
  if (!emailSender) throw new TypeError("createRecovery requires emailSender");

  // Per-IP rate limit (in-memory; multi-process would need a shared store).
  const ipAttempts = new Map();
  function checkRateLimit(ip) {
    const since = clock() - RECOVERY_WINDOW_MS;
    const attempts = (ipAttempts.get(ip) ?? []).filter((t) => t >= since);
    ipAttempts.set(ip, attempts);
    if (attempts.length >= RECOVERY_RATE_LIMIT) {
      const oldest = attempts.reduce((a, b) => a < b ? a : b, attempts[0]);
      const retryAfterMinutes = Math.max(1, Math.ceil((oldest + RECOVERY_WINDOW_MS - clock()) / 60000));
      return { allowed: false, retryAfterMinutes };
    }
    return { allowed: true };
  }
  function recordAttempt(ip) {
    const since = clock() - RECOVERY_WINDOW_MS;
    const attempts = (ipAttempts.get(ip) ?? []).filter((t) => t >= since);
    attempts.push(clock());
    ipAttempts.set(ip, attempts);
  }

  return {
    isValidEmail: (email) => emailSender.isValidEmail(email),

    async requestRecovery({ ip, email }) {
      if (!emailSender.isValidEmail(email)) {
        throw new RecoveryValidationError([{ field: "email", message: "email must be a valid address." }]);
      }
      const limit = checkRateLimit(ip);
      if (!limit.allowed) throw new RecoveryRateLimitedError(limit.retryAfterMinutes);
      recordAttempt(ip);

      // Find the tenant whose most recent verification was for this email.
      const verification = await registry.recoveries.findLatestVerificationForEmail(email);
      if (!verification) {
        // We don't reveal whether the email exists; just say "we sent a link
        // if the address is in our system". This is intentional to prevent
        // email enumeration. The actual send is skipped in that case.
        return { sent: false, skipped: true };
      }

      const token = emailSender.generateToken();
      const expires_at = new Date(now() + RECOVERY_TTL_MS).toISOString();
      await registry.recoveries.createRecovery({
        tenant_id: verification.tenant_id,
        email,
        token,
        expires_at
      });
      const link = `${baseUrl || ""}/console/api/recover?token=${encodeURIComponent(token)}`;
      const subject = "Recover your Alfred Memory API key";
      const text = [
        "Someone requested a key recovery for this Alfred Memory tenant.",
        "",
        "If this was you, click the link below to receive a new API key. The old one will be revoked.",
        link,
        "",
        "This link expires in 1 hour. If you didn't request this, ignore the email."
      ].join("\n");
      const result = await emailSender.send({ to: email, subject, text });
      return { sent: result.sent, skipped: result.skipped === true, link };
    },

    async consumeRecovery({ token }) {
      if (typeof token !== "string" || token.length === 0) return null;
      const recovery = await registry.recoveries.findRecoveryByToken(token);
      if (!recovery) return null;
      if (recovery.used_at) return null;
      if (new Date(recovery.expires_at).getTime() < now()) {
        return { expired: true, tenant_id: recovery.tenant_id };
      }

      // Find and revoke the active key for this tenant.
      const oldKey = await registry.recoveries.findActiveKeyForTenant(recovery.tenant_id);
      if (oldKey) {
        await registry.recoveries.revokeApiKey(oldKey.id);
      }

      // Issue a new key.
      const newKeyResult = await userService.provisionApiKey({ tenant_id: recovery.tenant_id, label: "recovery" });

      // Mark the recovery as used.
      await registry.recoveries.markRecoveryUsed(recovery.id, { newKeyId: newKeyResult.key.id, oldKeyId: oldKey?.id ?? null });

      return {
        tenant_id: recovery.tenant_id,
        email: recovery.email,
        api_key: newKeyResult.apiKey,
        key_prefix: newKeyResult.key.key_prefix,
        key_id: newKeyResult.key.id,
        old_key_id: oldKey?.id ?? null,
        consumed_at: new Date(now()).toISOString()
      };
    }
  };
}
