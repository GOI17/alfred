// Email sender for SaaS Web Onboarding.
//
// Thin wrapper around Nodemailer. The sender is OPT-IN: when
// ALFRED_SMTP_HOST is unset, send() is a no-op that logs the would-be
// email. This lets the server run in CI, local dev, and tests
// without requiring an SMTP server.
//
// Configuration via env vars:
//   ALFRED_SMTP_HOST          required to actually send
//   ALFRED_SMTP_PORT          default 587
//   ALFRED_SMTP_USER          optional
//   ALFRED_SMTP_PASSWORD      optional
//   ALFRED_SMTP_FROM          default "noreply@alfred.local"
//
// The sender never blocks the bootstrap response. send() returns a
// promise; failures are logged but do not throw to the caller.

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

    async send({ to, subject, text, html } = {}) {
      if (!enabled) {
        log.warn?.(`[email-sender] SMTP not configured; would send to=${to} subject="${subject}" text=${text?.slice(0, 80)}...`);
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
      } catch (err) {
        log.error?.("[email-sender] send failed: " + err.message);
        return { sent: false, skipped: false, error: err.message };
      }
    }
  };
}
