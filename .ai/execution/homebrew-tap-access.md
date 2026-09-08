---
id: execution/homebrew-tap-access
description: Prepare a curated Alfred runtime for anonymous third-party Homebrew installation while retaining private source.
owner: developer
phase: issue-204-homebrew-tap-access
issue: 204
status: preparation-in-progress
---

# Anonymous Homebrew distribution

## Goal and authorization boundary

Third parties must install and run Alfred without a GitHub account, credentials,
or collaborator access to GOI17/alfred. Source repository visibility and history
remain private. The collaborator-only authentication instructions do not satisfy
this goal and are superseded.

Authorized now: implement packaging and workflows, private review branches/PRs,
local artifact preparation and authorized verification. NOT authorized: public
repository creation, visibility changes, public commits or code/assets, releases,
or changing publisher credentials/settings. The user explicitly authorized reading/copying actual packages/core/ and
.ai/harnesses/ into the local review artifact and isolated production dependency
installation with lifecycle scripts disabled. This does not authorize editing
those protected paths or public activation. The other protected
paths .opencode/, .codex/, .agents/ remain excluded.

## Confirmed current state

GOI17/alfred and GOI17/homebrew-alfred are private. Anonymous API reads return 404.
Formula/alfred.rb exists, but downloads private Git source pinned to v0.7.2 and
28f64f4c1afe97390ae29639c15d170087e1a92e. The release has no runtime assets. Making
only the tap public cannot resolve source-download access. The previous
publisher succeeded; its distribution boundary was collaborator-only.

## Proposed public destination (requires later approval)

Use the existing GOI17/homebrew-alfred as the public tap and release-asset host,
subject to explicit approval to expose that tap's current tree and Git history.
Keep GOI17/alfred private. Publish a reviewed runtime asset named
`alfred-X.Y.Z-runtime.tar.gz` and its content manifest/checksum on the tap's
`vX.Y.Z` GitHub Release. The formula URL must be
`https://github.com/GOI17/homebrew-alfred/releases/download/vX.Y.Z/alfred-X.Y.Z-runtime.tar.gz`
with the actual archive SHA-256. No source-repository archive URL is acceptable.

## Requirements

### R1: Honest package boundary

Preserve the existing alfred CLI commands, guided setup and coding adapter
previews. Package only runtime JS/MJS, shell entrypoint, required SQL/schema/UI,
agent/skill/policy runtime metadata and third-party production dependencies with
licenses. Inventory every distributed file, size, mode and SHA-256. Clearly state
that JS, shell, HTML and agent instructions remain readable; this is not code
secrecy or a standalone native binary. Node is an explicit Homebrew dependency.
Repository history, .github workflows, tests, local configs, secrets, internal
execution specs, issue traces and historic releases are excluded. Historical
internal evaluation runners are not part of the end-user CLI/setup contract.

### R2: Reproducible allowlist builder

Use explicit reviewed include files/globs and sanitized package metadata, not a
copy of the checkout or whole .ai directory. Reject missing requirements,
unexpected paths, absolute/traversal paths, unsafe symlinks, local config/secrets,
and output paths overlapping inputs. Build tar+gzip with normalized sorted paths,
mtime, ownership and modes. Include a content manifest; produce a separate SHA256
for the archive. External dependency input must be resolved from a production
lock in an isolated authorized stage; never install implicitly in the builder.
Support fixtures for tests without reading protected actual source paths.

### R3: Offline-complete runtime

Avoid private Git, raw, API and installer release downloads in distributed setup.
Use the existing dependency-free Node guided TUI; omit optional OpenTUI binaries
and optional Transformers model downloads. Runtime profile configuration and
harness writes retain preview/apply decisions. Vendor the required production
runtime dependencies or otherwise prove their locked anonymous resolution at
install time. A test that only runs `alfred version` is insufficient: validate
SQLite lifecycle, server/MCP dependency loading, setup, and adapter previews.
Fresh-HOME verification must create missing SQLite tenant directories and
exercise MCP keyword search through GET /memories/search, including CRUD.
Run the same actual-runtime verifier on Node24 in isolated private PR CI.

### R4: Public formula

Add a release-asset source mode to the generator. Its public installation path
must require version + actual SHA256 and target the proposed public tap repository,
never private source Git/archive endpoints. Preserve Node/wrapper and preview-first
semantics. Public user instructions use Homebrew and Alfred only; never require
sharing source access or running gh auth. Before publication, label commands as
pending activation rather than claiming an anonymously accessible release exists.

### R5: Separate preparation and publication

The automatic release chain may prepare PRIVATE workflow artifacts for review;
it must not publish runtime code to the tap automatically. Replace the current
private-Git tap publisher accordingly. Provide a separate manual publication
workflow/tool that requires an explicitly approved artifact checksum and exact
destination, verifies the source is still private and destination already public,
and uploads precisely the reviewed bytes, manifest and formula. No visibility
changes, repo creation, credential setup or broad PAT fallback in this workflow.
Use a repository-scoped GitHub App for target release/contents writes if needed;
its setup is a pending human operation, never configure it during preparation.
Do not rely solely on an implicitly created GitHub environment as approval.
Require explicit configured approval checksums matching both the selected runtime
archive and the exact reviewed formula bytes. Bind source/builder revisions and
allowlist/production-lock hashes to the prepared candidate; reject mismatches.
Bind the builder revision to the successful preparation run HEAD before obtaining
target credentials. Reject replacement of a published version with differing bytes and refuse to
downgrade an already activated newer formula.
Publish assets and verify anonymous download SHA256 before activating the formula.
The initial locally reviewed candidate may use the existing publisher CLI with
its exact approved bytes and the existing authorized gh session credential after
separate publication approval. Keep that credential only in process memory,
never print/persist it, and restrict operations to the fixed publisher API paths.
Future automated publication retains a repository-scoped App with no broad-token
fallback. The workflow run-ID/HEAD binding applies to Actions-built
candidates; rebuilding from a later merge commit changes the embedded provenance
and requires a new hash review. Never substitute a rebuilt archive silently.

### R6: Review and verification

Update issue #204 and BOTH existing PR titles/descriptions/specs to this final
scope. Stage the concrete formula and target README/workflows for tap PR #2 while
it remains private; no dummy SHA may be presented as a ready formula. Record the
archive listing, disclosures, hash, destinations, tests and exact remaining
operations in a review document. Verify without credentials using an isolated
local HTTP download/extraction and runtime smoke checks; final live GitHub/brew
installation checks remain pending publication approval. Never claim a public
end-to-end install before it happens. Tests must cover deterministic archive
contents, missing/unsafe paths, dependency closure, private URL rejection, approval
mismatch and order of publication, including meaningful failure cases.

### R7: Scope and traceability

All implementation delegated to developer, model inherited from the harness.
Use atomic writes and record decisions. Preserve unrelated work and protected
paths; do not execute full-repo validators that cross the permission boundary.
Do not update baselines. Keep the existing site-link validator fix where needed.

## Completion gates

- [x] Builder, public formula mode and private preparation/manual publisher are reviewable.
- [ ] Actual runtime archive and full content inventory are prepared with authorized inputs.
- [x] Relevant fixtures and credential-free local HTTP retrieval pass (23 runtime cases).
- [ ] Actual runtime smoke checks pass with authorized real inputs.
- [x] Both draft PRs describe anonymous distribution and disclose readable content.
- [ ] Public destination/tree/history and exact pending operations are presented for approval.
- [ ] Public activation and live anonymous installation (requires specific later approval).

## References

- Issue: https://github.com/GOI17/alfred/issues/204
- Main PR: https://github.com/GOI17/alfred/pull/206
- Tap PR: https://github.com/GOI17/homebrew-alfred/pull/2
- Homebrew: https://docs.brew.sh/Formula-Cookbook
- Release assets: https://docs.github.com/en/rest/releases/assets
