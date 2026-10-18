---
id: execution/skill-lifecycle
description: Inspect installed skills and manage local or pinned GitHub skill packages through a deterministic CLI.
owner: architect
phase: issue-227
issue: https://github.com/GOI17/alfred/issues/227
---

# Skill lifecycle and installed inventory

## Goal

Users can see which skills exist on disk, where they came from, what revision
was installed, and whether local content changed. They can preview and apply
installation, update, and removal through `alfred skills`.

## Context

`.ai/skills/registry.json` is the lazy activation catalog. Its `version` describes
the registry, not individual installed skills. Codex and opencode previews
currently transform and copy canonical `SKILL.md` bodies; setup copies generated
directories without recording an installation receipt for each skill. Existing
skills therefore have no trustworthy provenance merely because their names
match the catalog. Pi currently exposes registry metadata without a supported
skill-body installation target.

## Architecture decision

Implement `packages/skill-manager` as an operational package, following the
existing `profile-manager` boundary. This release adds deployment bookkeeping,
filesystem inspection, and source acquisition; it does not change core skill
activation, `SkillRegistry`, permission evaluation, or orchestration semantics.
The pressure for a separate package is shared CLI/setup bookkeeping across two
harnesses, two scopes, and multiple source types.

Keep pure receipt validation, inventory comparison, and operation planning
separate from filesystem, GitHub transport, CLI rendering, and harness path
resolution. Pure modules receive data rather than importing Node filesystem,
network clients, or harness packages. Harness-specific targets belong to small
adapter/infrastructure modules; they do not appear in pure rules. The core
package must not import this package, and this release requires no core change.
Future shared domain behavior belongs in core rather than being duplicated here.

Reuse the existing preview/explicit-approval convention and TraceEvent envelope.
Do not import `activateProfile` or `createProfileTrace`: their replacement rules
and event names are profile-specific. The Codex primary-instructions helper
provides a precedent for `approval: false` by default, atomic replacement, and
refusing symlink targets. It is not a generic skill installer.

## Requirements

### R1: Public CLI

Expose `alfred skills list`, `info`, `install`, `update`, and `remove` through
the existing thin CLI dispatcher. Each command has help; reject unknown flags,
missing values, ambiguous selections, and unsupported harnesses. Provide human
readable output and `--json` machine output.

- `list`: inspect actual installations in the requested scopes/harnesses.
- `info <name>`: report source, revision, integrity, management status, and path.
- `install <source>`: preview a selected skill package and apply only explicitly.
- `update <name>`: resolve its recorded source again and preview the change.
- `remove <name>`: preview removal of the selected managed installation.

Support `--cwd`, `--scope project|global`, and `--harness codex|opencode`.
Read commands may combine both scopes/harnesses by default. Mutating commands
must select one unambiguous destination; default scope is project. Any inferred
harness must be shown in the plan, and ambiguous discovery requires a flag.
Same-name installations in different scopes/harnesses remain separate rows.

Examples of the intended command shape:

```sh
alfred skills list --json
alfred skills info tdd --harness codex --scope project
alfred skills install ./skills/tdd --harness codex
alfred skills install ./skills/tdd --harness codex --apply
alfred skills install https://github.com/owner/repo --skill skills/tdd --ref main --harness codex
alfred skills update tdd --harness codex --scope project --apply
alfred skills remove tdd --harness codex --scope project --apply
```

`--skill` identifies a selected repository-relative skill directory. Do not
silently install every skill in a repository. Catalog output, if offered, is
explicitly labeled and must not inflate the installed inventory.

### R2: Inventory describes observed state

Read commands work offline, require no installation receipt, and do not create
or repair receipts. Scan supported discovery roots for skill directories and
reconcile them against lock entries. Report:

- `managed/intact`: a receipt exists and the observed tree matches its digest;
- `managed/modified`: files were edited, added, removed, or had relevant modes changed;
- `managed/missing`: the recorded directory no longer exists;
- `unmanaged`: a skill exists without an Alfred receipt;
- `invalid` or an explicit diagnostic for malformed metadata, unsafe links,
  unreadable roots, or corrupt lockfiles.

Distinguish management status from integrity status in structured output.
Never silently replace a corrupt lockfile with an empty inventory. Discovery
must not execute scripts, load skill instructions as instructions to the agent,
or claim the running harness has loaded a discovered skill. Explain that a new
harness session may be required after changes.

### R3: Version and provenance are evidence-based

An installed revision is identified by an immutable content digest and, when
available, a Git commit. A declared skill version is optional metadata and must
be labeled as declared; it is not proof of content identity. Do not substitute
the Alfred release, registry schema version, branch name, or a guessed semver.

For GitHub sources store the canonical repository, selected skill path,
requested ref, and resolved full commit. Display a short commit while retaining
the full value. For local sources store the selected absolute source path and
snapshot digest. If no version exists, display a commit or `sha256:<prefix>`.
Unmanaged skills show unknown provenance/version unless a version is explicitly
declared; their currently observed digest does not imply an installation date
or an original source. Show the observed digest even when provenance is unknown.
Name/content similarity never silently adopts a skill. Explicit installation
from a specified source may adopt an exactly matching unmanaged tree under R7;
this proves its current match, not historical provenance.

### R4: Lockfile contract

Use project `<project>/.alfred/skills-lock.json` and global
`<home>/.alfred/skills-lock.json`, independently. Keep the schema version
separate from skill version metadata. Entries are keyed by installation identity
(harness, scope, and skill directory/name), not name alone.

Each managed entry records at least:

```json
{
  "schemaVersion": 1,
  "installations": [
    {
      "name": "tdd",
      "harness": "codex",
      "scope": "project",
      "targetPath": ".agents/skills/tdd",
      "source": {
        "kind": "github",
        "repository": "https://github.com/owner/repo",
        "skillPath": "skills/tdd",
        "requestedRef": "main",
        "resolvedCommit": "<full commit>"
      },
      "declaredVersion": null,
      "sourceDigest": "sha256:<digest>",
      "installedDigest": "sha256:<digest>",
      "installedAt": "<ISO timestamp>",
      "updatedAt": "<ISO timestamp>"
    }
  ]
}
```

A local source uses `kind: local` and `path` instead of repository/ref fields.
Validate the complete record before use, including unique identities, digests,
and destination containment. Never trust a stored target path as authority to
write or remove an arbitrary location: recompute the allowed destination.
For adoption, record an adoption/management timestamp and leave the original
installation time unknown; do not relabel the adoption date as the original
installation date. Project target paths are relative to the selected project. The lockfile is
machine installation state, separate from `.ai/skills/registry.json`.

Hash the entire installed package with deterministic ordering, unambiguous path
and byte boundaries, and relevant executable modes. Preserve files referenced
by a skill (`scripts`, `references`, assets, etc.), not only `SKILL.md`.
Exclude source-control internals explicitly rather than quietly dropping needed
resources. Source and installed digests may differ when an existing Alfred
adapter transforms frontmatter; do not compare a transformed artifact directly
to an untransformed source hash.

### R5: Supported sources

Accept a local directory containing a valid `SKILL.md` and a selected directory
from a GitHub repository. Resolve a remote ref to a full commit before obtaining
content, then fetch all files from that same immutable commit. Record network
access as source acquisition with zero model-provider calls. Preview output
identifies the repository/ref and resolved revision; read-only inventory never
contacts GitHub.

Use Node built-ins and existing system capabilities; add no runtime dependency
or package-manager installation. GitHub tree/blob/raw endpoints or a safely
validated immutable snapshot are acceptable. Reject traversal, absolute paths,
symlinks, hardlinks, submodules, device entries, invalid names, unbounded trees,
and excessive payload sizes before materialization. Never run downloaded code,
installation hooks, `git clone`, or shell-interpolated source text. Fail with an
actionable error for unsupported/private sources rather than searching for
credentials. A missing local source blocks update without damaging installation.

Updates follow the recorded requested ref. A source pinned to a commit stays
pinned unless an explicit new ref is supplied. A source/content revision that
has not changed is a no-op, without rewriting installed timestamps.

### R6: Harness targets and scope

The following native roots define the first release's writable targets:

| Harness | Project | Global |
| --- | --- | --- |
| Codex | `<cwd>/.agents/skills` | `<home>/.agents/skills` |
| opencode | `<cwd>/.opencode/skills` | `<config-home>/opencode/skills` |

`config-home` is absolute `XDG_CONFIG_HOME` when set, otherwise `<home>/.config`.
Reject an invalid relative override. `CODEX_HOME` does not redirect the current
Codex user skills root. Resolve these paths in target adapters, with injected
home/environment values for tests. `OPENCODE_CONFIG_DIR` is an additional
runtime configuration root, not a silent replacement for the chosen native
project/global installation target.

Inventory output identifies scanned roots and its coverage. Custom config roots,
ancestor-project inheritance, legacy roots, `.claude` compatibility locations,
admin/system bundles, and plugin caches may be documented as outside first-release
coverage; do not claim a complete inventory of every effective runtime skill.
OpenCode can also discover `.agents` roots: a physical installation must not be
counted or removed twice merely because multiple harnesses can discover it.
List physical locations and their native management target; never claim this
exclusively determines runtime discovery or name precedence.

These native roots follow the current [Codex skills documentation](https://learn.chatgpt.com/docs/build-skills)
and [OpenCode skills documentation](https://opencode.ai/docs/skills/).
Support these Codex/opencode project/global targets without asserting support
for Pi or contract-only harnesses.

The selected working tree is the project scope. Do not redirect skill
installation into another Git worktree merely because it shares a Git common
directory. Global writes require an explicit global selection. Check symlinks
and containment for destination ancestors, the skill directory, and state files.

### R7: Preview and apply

Mutations default to a reviewable plan: operation, source, destination, current
revision/integrity, candidate revision, files affected, and blockers. `--apply`
is explicit authorization for the selected operation; library calls likewise
require explicit approval. Dry run overrides apply if both are supplied. A
preview never writes live harness files or lock entries.

Before applying, reacquire/verify the candidate snapshot and re-read the target,
lock state, and path safety. If current state changed from the plan, reject as
stale rather than applying earlier approval to different content. For an existing unmanaged target, installation from an explicitly selected
source may propose `adopt` only when the whole installed tree exactly matches
the candidate bytes and executable modes. The plan must say that apply records
management/provenance without rewriting skill files. Revalidate equality before
writing the receipt. A different tree blocks installation. Adoption records the
source match observed now, without asserting the historical source or install
date. A source equal to the installed target path itself is not an updatable
external source and must be rejected.

Update/remove require a managed, intact target. Modified, missing, or unmanaged
targets stop with a clear reason; no force-overwrite or silent deletion is
supported. `--apply` alone is sufficient CLI authorization: do not introduce a
second redundant `--approve` flag. The CLI builds and displays a fresh plan
before applying it; the library exposes plan/apply separately so stale snapshots
can be rejected. Persisting plans across commands is not required for this release.

### R8: Atomic writes and failure recovery

Stage complete content in the destination filesystem, validate it, then rename.
Write the lockfile through temporary file plus rename. Coordinate the skill tree
and receipt with backups/rollback or a small recoverable transaction. Failure
must leave the previous installation and receipt usable, or an explicit
recoverable diagnostic; never return success after only one side changed.

Serialize competing mutations using a scoped exclusive lock or equivalent
conflict detection. Recheck safety and observed digests under that guard. Remove
only the selected managed directory; preserve sibling skills and unrelated
harness configuration. Backups and temporary files must not be discovered as
live skill directories. Cleanup must not mask the original error.

### R9: Existing setup installations

Existing setup-installed skills appear in `list` immediately as unmanaged with
honest unknown provenance. Do not infer that matching current bundled content
proves which Alfred release originally installed it. Receipt integration for
future `alfred setup` can call the same package after successful writes, but
must not bypass preview/approval, overwrite modified skills, or invent an old
source revision. Explicit exact-match adoption under R7 gives existing installations a safe
migration path; automatic/bulk reconciliation remains outside this release.
A generated skill whose frontmatter differs from canonical source can be
adopted using the corresponding exact preview as source, not by assuming the
transformation is equivalent. Help/documentation must explain this boundary.

### R10: Traces

Produce structured `skill_manager_operation` results/events for preview,
applied, unchanged, blocked, and failed mutations. Follow the established
envelope: `trace_id`, `timestamp`, `event`, `actor`, and `data`. Include operation,
skill identity, scope, harness, sanitized source, target, approval state, old/new
digest where known, status, reason, and `provider_calls: 0`.

Applied/failed apply operations persist trace records beneath the selected
`.alfred/observability/` directory using safe atomic writes. Preview/read results
may carry the trace in JSON without persistence. Do not serialize credentials,
source file contents, or signed/authenticated URLs. Record explicit approval
and provider-request avoidance. This work changes no model assignments, eval
baselines, permission defaults, or live user harness configuration during tests.

### R11: Validation and delivery

Use temporary directories and injected GitHub transport fixtures. Cover local
and GitHub lifecycle, project/global isolation, same names in separate scopes,
truthful legacy discovery and exact-match adoption without rewriting,
missing/modified/unmanaged targets, safe resources
copying, pinned refs, source failures, no-op updates, stale plans, corrupt state,
symlink/traversal rejection, and rollback after a filesystem failure. CLI tests
verify dispatcher routing, help, machine output, and preview/apply behavior.
Run package checks and relevant existing CLI/installer checks; run required
repository checks where permissions permit. Never update baselines merely to
make a regression pass or install skills in the developer's real home/project.

## Implementation map

- `packages/skill-manager/src/`: pure model/planning, filesystem store, source
  readers, target adapters, lifecycle service, and CLI entrypoint.
- `packages/skill-manager/test/`: deterministic unit and integration fixtures.
- `packages/memory-server/scripts/alfred.mjs`: dispatch `skills` and show help.
- Root `package.json`: package test/check integration.
- `packages/skill-manager/README.md` and user CLI documentation: behavior,
  supported destinations, unknown legacy versions, and preview/apply examples.
- Optional subsequent setup integration: `install.sh` and preview receipts;
  existing whole-directory copies are not a safe automatic adoption mechanism.

## Completion conditions

- [x] All five commands are reachable from `alfred skills` with usable help.
- [x] Inventory reports real managed and unmanaged skills without network access.
- [x] Local and GitHub sources install/update with reproducible revision metadata.
- [x] Codex/opencode project/global destinations remain isolated and explicit.
- [x] Preview is default and apply requires explicit authorization and revalidation.
- [x] Unmanaged identical trees can be explicitly adopted without rewriting or invented history.
- [x] Modified/unmanaged targets and unsafe paths cannot be overwritten or removed.
- [x] Tree/receipt failures preserve recoverable state and have regression coverage.
- [x] Trace results preserve provenance, approval evidence, and zero provider calls.
- [x] Tests/checks pass without touching real harness configuration or baselines.

## Validation evidence and delivery limits

The independent QA record is
`.ai/observability/generated/issue-227-skill-lifecycle-qa.json`.
The skill-manager suite passes 80 tests, its syntax checks pass, and 27 related
existing CLI/packaging tests pass. Review covered asynchronous source acquisition,
non-regular files, modified installed control directories, receipt rollback,
shared home/project roots, and faithful previews of removed resources.

The complete repository test/check scripts were not executed because they read
protected core paths outside this task's permission scope. Validation used
synthetic temporary roots and injected GitHub responses: no live harness skill
was installed and no dependencies or eval baselines were changed. A full runtime
archive build and live GitHub download were not performed. Runtime allowlist
coverage is included and validated by packaging regression tests.

When project and home canonical roots coincide, project mutations are rejected
with `E_SCOPE_ALIAS`; the user must select global scope explicitly or a distinct
project. This prevents two scopes from corrupting the same receipt store and
never silently redirects a project operation into global state.

## References

- Issue: https://github.com/GOI17/alfred/issues/227
- `.ai/instructions/install-management.md`
- `.ai/skills/README.md` and `.ai/skills/registry.json`
- `docs/architecture/002-hexagonal-architecture.md`
- `docs/architecture/003-monorepo-boundaries.md`
- `packages/profile-manager/src/index.js`
- `packages/codex-adapter/src/primary-instructions.js`
- `packages/codex-adapter/src/runtime.js`
- `packages/opencode-adapter/src/runtime.js`
