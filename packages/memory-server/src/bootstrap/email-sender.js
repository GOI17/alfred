// Email sender for SaaS Web Onboarding.
//
// Thin wrapper around Nodemailer. The sender is OPT-IN: when
// ALFRED_SMTP_HOST is unset, readiness fails closed and send() is a no-op.
// This lets the server run in CI, local dev, and tests
// without requiring an SMTP server.
//
// Configuration via env vars:
//   ALFRED_SMTP_HOST          required to actually send
//   ALFRED_SMTP_PORT          default 587
//   ALFRED_SMTP_USER          optional
//   ALFRED_SMTP_PASSWORD      optional
//   ALFRED_SMTP_FROM          default "noreply@alfred.local"
//
// SMTP diagnostics deliberately omit recipients, content, recovery links,
// tokens, and credentials.

import { randomBytes } from "node:crypto";

const DEFAULT_FROM = process.env.ALFRED_SMTP_FROM ?? "noreply@alfred.local";

function isValidEmail(value) {
  return typeof value === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) && value.length <= 320;
}

function generateToken() {
  return randomBytes(24).toString("base64url"); // 32 chars
}

export function createEmailSender({
  host = process.env.ALFRED_SMTP_HOST ?? null,
  port = Number(process.env.ALFRED_SMTP_PORT ?? 587),
  user = process.env.ALFRED_SMTP_USER ?? null,
  password = process.env.ALFRED_SMTP_PASSWORD ?? null,
  from = DEFAULT_FROM,
  nodemailer = null,
  log = console
} = {}) {
  const enabled = Boolean(host);
  let transporter = null;

  async function getTransporter() {
    if (transporter) return transporter;
    if (!nodemailer) {
      try {
        nodemailer = (await import("nodemailer")).default;
      } catch {
        return null;
      }
    }
    transporter = nodemailer.createTransport({
      host, port,
      auth: user ? { user, pass: password } : undefined,
      secure: port === 465
    });
    return transporter;
  }

  return {
    isEnabled() { return enabled; },
    isValidEmail,

    generateToken,

    async checkReadiness() {
      if (!enabled) return { ready: false, reason: "not_configured" };
      const tx = await getTransporter();
      if (!tx) {
        log.warn?.("[email-sender] SMTP transport unavailable");
        return { ready: false, reason: "transport_unavailable" };
      }
      try {
        if (typeof tx.verify === "function") await tx.verify();
        return { ready: true };
      } catch {
        log.error?.("[email-sender] SMTP readiness check failed");
        return { ready: false, reason: "transport_unavailable" };
      }
    },

    async send({ to, subject, text, html } = {}) {
      if (!enabled) {
        log.warn?.("[email-sender] SMTP not configured; message skipped");
        return { sent: false, skipped: true };
      }
      if (!isValidEmail(to)) {
        return { sent: false, skipped: false, error: "invalid_recipient" };
      }
      const tx = await getTransporter();
      if (!tx) {
        log.warn?.("[email-sender] nodemailer not installed; skipping send");
        return { sent: false, skipped: true };
      }
      try {
        await tx.sendMail({ from, to, subject, text, html });
        return { sent: true };
      } catch {
        log.error?.("[email-sender] SMTP send failed");
        return { sent: false, skipped: false, error: "delivery_failed" };
      }
    }
  };
}
