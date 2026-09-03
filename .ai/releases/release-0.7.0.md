# Release 0.7.0: OAuth and account recovery

Alfred 0.7.0 makes Alfred Memory usable directly from ChatGPT Actions and
hardens the account-recovery path from tenant provisioning through OAuth
continuation.

## Highlights

- Adds OAuth Authorization Code support for the Alfred Memory Custom GPT.
- Supports Neon pooled tenant connections without unsupported startup
  `search_path` parameters.
- Adds recovery-email readiness checks and a secure, one-time API-key result
  page that does not expose credentials as raw JSON.
- Preserves a validated internal OAuth continuation after account recovery,
  while unsafe or missing destinations fall back to the console.
- Fixes guided setup review behavior and prevents setup from assigning models.
- Publishes stable release formulas automatically to the private Homebrew tap.

## Compatibility and rollout

- Existing Alfred API keys continue to work alongside OAuth.
- Homebrew remains the supported packaged installation path with `alfred setup`.
- The `alfredlabs.org` Resend sender migration remains outside this release
  until its external domain and credential setup are approved and verified.

## Validation

- Repository checks and full test suite: pass on the release candidate.
- Release and Homebrew contract validation: pass on the release candidate.
- Homebrew formula style, strict audit, upgrade, and test: pending publication.
- Provider calls: 0.

## Traceability

- Issue: `#153`
- Branch: `issue-153-release-0.7.0`
- Specification: `.ai/execution/release-0.7.0.md`
- Trace: `.ai/observability/generated/release-0.7.0.json`
