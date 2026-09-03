---
id: execution/smtp-recovery
description: Make API-key recovery SMTP-ready and fail closed when delivery is unavailable.
phase: issue-143-smtp-recovery
author: core
issue: 143
---

# SMTP-ready API-key recovery

## Goal

Send real recovery messages in production while preserving email
anti-enumeration and giving users an honest response when SMTP is unavailable.

## Requirements

The user authorized this implementation, production secret configuration, and
the corresponding additive regression-baseline update on 2026-09-02.

### R1: Global readiness gate

1. Recovery must validate the email format before attempting SMTP access.
2. Recovery must check transport readiness before rate limiting or looking up
   the email.
3. An unavailable transport must produce HTTP `503` with code
   `recovery_unavailable` for every email address.
4. SMTP diagnostics must not log recipients, recovery links, tokens, or
   credentials.

### R2: Anti-enumeration

1. Once SMTP is ready, registered and unregistered addresses must receive the
   same public `200` response.
2. A recipient-specific delivery failure must not change that public contract.

### R3: Runtime dependency

1. Nodemailer must be a declared production dependency of the Memory server.
2. The workspace lockfile must pin the resolved dependency graph.
3. The production container must install the dependency through its existing
   frozen-lockfile build.

### R4: Atomic deployment configuration

1. The Fly workflow must require all five SMTP settings.
2. OAuth and SMTP settings must be imported through standard input in one
   staged operation before deploy.
3. Secret values must never be printed.

### R5: Verification

1. Deterministic tests must cover unavailable and ready transports.
2. Memory-server checks and tests must pass.
3. Production must return the generic success contract after SMTP activation.
4. Provider calls remain `0`.

## Completion conditions

- [ ] Missing or unusable SMTP returns the global `503` contract.
- [ ] Ready SMTP preserves the anti-enumeration response.
- [ ] Nodemailer is available in the production image.
- [ ] SMTP secrets are staged atomically with OAuth secrets.
- [ ] The console artifact surfaces the server error.
- [ ] Tests, checks, and deployment pass.
- [ ] A recovery message reaches the registered address.
- [ ] Provider calls remain `0`.

## References

- Issue: `#143`
- Recovery service: `packages/memory-server/src/bootstrap/recovery.js`
- Email adapter: `packages/memory-server/src/bootstrap/email-sender.js`
- HTTP router: `packages/memory-server/src/console-router.js`
- Fly workflow: `.github/workflows/deploy-fly.yml`
