---
id: execution/alfredlabs-email
description: Move Alfred Memory recovery delivery to an authenticated alfredlabs.org sender.
phase: issue-147-alfredlabs-email
author: core
issue: 147
---

# Authenticated AlfredLabs recovery email

## Goal

Deliver Alfred Memory recovery messages through a least-privilege
transactional SMTP credential with the visible sender
`Alfred Memory <recovery@alfredlabs.org>`, replacing the production dependency
on personal Gmail credentials.

## Context

The Memory server already has a provider-neutral Nodemailer adapter and a
fail-closed recovery contract. Production deployment examples still describe
personal Gmail SMTP. Public DNS currently routes inbound mail through
Cloudflare and has a root SPF record, so transactional delivery must avoid
replacing the root MX records or publishing a second root SPF record.

Repository work is deterministic and local-only. Creating a provider account,
purchasing service, changing Cloudflare DNS, changing GitHub or Fly secrets,
deploying, and sending a production verification message are privileged
external actions that require explicit human approval after review of the
exact plan.

## Requirements

### R1: Provider and sender contract

1. Use Resend's authenticated SMTP relay for recovery delivery.
2. Use `Alfred Memory <recovery@alfredlabs.org>` as the visible From identity.
3. Keep the existing provider-neutral `ALFRED_SMTP_*` runtime interface and
   Nodemailer transport.
4. Use Resend SMTP host `smtp.resend.com`, port `465`, username `resend`, and a
   sending-only Resend API key as the SMTP password.

### R2: DNS authentication plan

1. Verify the root sending domain `alfredlabs.org` with Resend without enabling
   inbound mail in Resend.
2. Add only the provider-required `send.alfredlabs.org` MX/SPF records and the
   `resend._domainkey.alfredlabs.org` DKIM record shown by Resend for this
   domain. The DKIM public key is provider-generated and must be copied exactly
   from the approved domain setup screen before any DNS mutation.
3. Add `_dmarc.alfredlabs.org` as TXT with the initial monitoring policy
   `v=DMARC1; p=none; adkim=r; aspf=r; pct=100`. This establishes DMARC
   without assuming that a DMARC-report mailbox has already been routed.
4. Preserve the current root MX records and root SPF record used by Cloudflare
   Email Routing.
5. Use manual Cloudflare DNS entry rather than granting Resend broad Domain
   Connect access.
6. Require explicit human approval before provider signup or any DNS mutation.

### R3: Deployment secrets

1. Replace the personal Gmail Actions credential with one repository secret
   named `ALFRED_RESEND_SMTP_PASSWORD` containing only the least-privilege
   Resend sending key.
2. Map that secret to runtime `ALFRED_SMTP_PASSWORD` without printing it.
3. Treat the host, port, username, and From identity as reviewed non-secret
   deployment configuration.
4. Continue staging OAuth and SMTP values atomically through standard input.
5. Require explicit human approval before GitHub/Fly secret rotation or a
   production deployment.

### R4: Operator documentation

1. Replace Gmail-specific examples with the exact Resend sender, SMTP, DNS,
   secret-rotation, and verification plan.
2. Document the initial free-tier cost and the paid-tier threshold from
   Resend's official pricing.
3. Document that the provider-generated DKIM value is intentionally never a
   repository secret and must be copied exactly into public DNS.
4. Document a verification sequence for Resend domain status, public DNS,
   Gmail delivery, and Gmail `Authentication-Results` showing SPF, DKIM, and
   DMARC pass/alignment.

### R5: Deterministic validation and traceability

1. Add regression coverage for the branded deployment contract and absence of
   Gmail production configuration.
2. Run the Memory server checks/tests and repository policy/release validators.
3. Emit delegation and provider-request trace events with provider calls `0`.
4. Never read, print, log, or commit credential values.

## Completion conditions

- [x] The repository documents Resend and
      `Alfred Memory <recovery@alfredlabs.org>` as the production contract.
- [x] Deployment requires `ALFRED_RESEND_SMTP_PASSWORD` and no personal Gmail
      secret or sender configuration.
- [x] Regression tests cover the deployment contract.
- [x] Applicable checks, tests, and validators pass.
- [x] Trace events record direct execution and local-only provider policy.
- [ ] Resend signup/domain creation is approved and complete.
- [ ] Exact provider-generated DKIM data is reviewed before DNS mutation.
- [ ] Cloudflare SPF, DKIM, and DMARC records are approved and published.
- [ ] GitHub/Fly secrets are approved and rotated without exposure.
- [ ] A Gmail delivery shows SPF, DKIM, and DMARC pass with alignment.
- [x] Provider calls remain `0` for deterministic repository work.

## References

- Issue: `#147`
- Prior SMTP spec: `.ai/execution/smtp-recovery.md`
- Fly deployment: `.github/workflows/deploy-fly.yml`
- Operator guide: `.ai/docs/fly-deploy.md`
- Email adapter: `packages/memory-server/src/bootstrap/email-sender.js`
- Memory server guide: `packages/memory-server/README.md`
- Resend domain docs: `https://resend.com/docs/dashboard/domains/introduction`
- Resend Cloudflare DNS docs: `https://resend.com/docs/knowledge-base/cloudflare`
- Resend SMTP docs: `https://resend.com/docs/send-with-smtp`
- Resend pricing: `https://resend.com/pricing?product=transactional`
- Resend DMARC docs: `https://resend.com/docs/dashboard/domains/dmarc`
- Cloudflare email-authentication docs:
  `https://developers.cloudflare.com/dmarc-management/security-records/`
