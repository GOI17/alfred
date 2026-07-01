// Email verification orchestrator.
//
// Lifecycle:
//   1. After successful tenant + key provisioning, the bootstrap
//      orchestrator calls `createVerification({ tenant_id, email })`.
//   2. This module stores a row in tenant_email_verifications, sends
//      an email with the magic link, and returns the token.
//   3. When the user clicks the link, the server hits
//      GET /console/api/verify?token=...; the handler calls
//      `consumeVerification(token)`, which validates the token,
//      marks it used, and returns the tenant_id (or null if invalid).
//
// Backward compat: when no email is provided, no verification row is
// created. The tenant is created without email verification.

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function createVerification({ registry, emailSender, baseUrl = "", now = () => Date.now() } = {}) {
  if (!registry) throw new TypeError("createVerification requires registry");
  if (!emailSender) throw new TypeError("createVerification requires emailSender");

  return {
    isValidEmail: (email) => emailSender.isValidEmail(email),

    async createVerification({ tenant_id, email }) {
      if (!emailSender.isValidEmail(email)) {
        return { sent: false, error: "invalid_email" };
      }
      const token = emailSender.generateToken();
      const expires_at = new Date(now() + VERIFICATION_TTL_MS).toISOString();
      await registry.emailVerifications.createEmailVerification({
        tenant_id,
        email,
        token,
        expires_at
      });
      const link = `${baseUrl || ""}/console/api/verify?token=${encodeURIComponent(token)}`;
      const subject = "Verify your Alfred Memory email";
      const text = [
        "Welcome to Alfred Memory.",
        "",
        "Click the link below to verify your email and activate your tenant:",
        link,
        "",
        "This link expires in 24 hours."
      ].join("\n");
      const result = await emailSender.send({ to: email, subject, text });
      return { sent: result.sent, skipped: result.skipped === true, token, link };
    },

    async consumeVerification(token) {
      if (typeof token !== "string" || token.length === 0) return null;
      const row = await registry.emailVerifications.findEmailVerificationByToken(token);
      if (!row) return null;
      if (row.used_at) return null;
      if (new Date(row.expires_at).getTime() < now()) return { expired: true, tenant_id: row.tenant_id, email: row.email };
      await registry.emailVerifications.markEmailVerificationUsed(row.id);
      return { tenant_id: row.tenant_id, email: row.email, verified_at: new Date(now()).toISOString() };
    }
  };
}
