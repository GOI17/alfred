---
id: execution/skills-chat-entrypoint
description: Expose the existing skill lifecycle from chat with honest harness invocation, public search, and conversational authoring.
owner: architect
phase: issue-227-chat-continuation
issue: https://github.com/GOI17/alfred/issues/227
parent_spec: .ai/execution/skill-lifecycle.md
---

# Skills management from chat

## Goal and boundary

Users can ask Alfred to add, list, search, remove, and create skills without
leaving their current conversation. Reuse `packages/skill-manager` for every
installed-state read and mutation. Preserve its source pinning, inventory,
preview, integrity, receipt, and rollback contracts. This continuation adds
one canonical instruction skill, thin harness entrypoints, public catalog
search, and a named-source selection convenience. It adds no daemon, TUI,
provider client, second registry, or independent installer.

The task continues issue #227 / PR #228 in the verified dedicated worktree
`issue-227-skill-lifecycle`. It does not install new live artifacts into the
user's actual `.agents`, `.codex`, or `.opencode` directories during development.
Core and protected harness sources remain untouched. The referenced
`.ai/instructions/skill-creation.md` is absent; do not claim it exists or invent
instructions attributed to it.

## Requirements

### R1: One canonical chat skill

Add `.ai/skills/project/alfred/SKILL.md` and its registry metadata. The skill
activates for an explicit request to operate Alfred skills, not incidental
mentions of Alfred or general development. The canonical body routes:

| Chat request | Action |
| --- | --- |
| `skills add <source>` | Existing manager install/preview/apply flow |
| `skills list` | Existing offline inventory |
| `skills search <query>` | Read-only public catalog search |
| `skills remove <name>` | Existing managed/intact removal flow |
| `skills create <idea or name>` | Conversational authoring under R5 |
| `skills info <name>` | Existing offline provenance/detail |
| `skills update <name>` | Existing update preview/apply flow |

No arguments or an incomplete operation returns short contextual help. A bare
name for add is resolved by search and explicit source selection; never choose
an unrelated same-name repository or bulk install a whole repository. Ask only
for information needed to disambiguate source, scope, target, or requested
behavior, and reuse established session context.

Treat all request arguments and fetched metadata as data. Do not evaluate shell
text from a user query or catalog result. Use structured tool arguments or
safe argument arrays when invoking the existing CLI. Prefer JSON output for
reliable interpretation and summarize the result in the conversation.

### R2: Honest harness invocation and adapter artifacts

Codex supports explicit `$alfred skills ...` through its skill mechanism. Its
`/skills` surface is a selector; this release does not register a native
`/alfred` developer command. If a host actually delivers literal `/alfred skills
...` as a message, the skill may interpret that text. If the host intercepts it,
show the supported `$alfred` invocation instead of promising slash-menu parity.

Generate `.agents/skills/alfred/SKILL.md` using the existing canonical-body
preview flow. Keep the harness's default invocation policy: requesting a chat
command does not require disabling implicit activation. The concrete skill
description and existing preview/approval gates control when and how it acts.
No `agents/openai.yaml`, model assignment, permission override, or generic
resource-copy framework is needed for this entrypoint.

For OpenCode generate `.opencode/skills/alfred/SKILL.md` and a thin native
`.opencode/commands/alfred.md` preview. The command passes `$ARGUMENTS` as task
text and tells the current primary agent to load the canonical Alfred skill.
It must not duplicate the lifecycle instructions, inject a fixed model, broaden
permissions, or embed automatic shell execution. This provides native
`/alfred skills ...` on OpenCode.

Existing preview generation and approved setup application deliver these files.
The shell setup already copies the relevant generated directories; extend only
where an explicit file-kind/filter or runtime allowlist needs support. The
Go setup confirmation contract remains unchanged. Test generated artifacts and
packaged assets, not real live harness configuration.

Sources for this capability boundary: [Codex skills](https://learn.chatgpt.com/docs/build-skills),
[Codex developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli),
and [OpenCode commands](https://opencode.ai/docs/commands/).

### R3: Reuse the CLI, with a small add alias

Expose `alfred skills add` as an exact alias of `install`; existing `install`
syntax and behavior remain supported. Do not fork planning, receipts, approval,
or apply semantics. Both aliases accept the same flags.

The skill can invoke an installed `alfred` executable, or the known source
checkout dispatcher when operating in Alfred development. Do not guess a
Homebrew Cellar path, install a dependency, clone a repository, or run setup
silently when the executable is unavailable. Report the missing capability
briefly and preserve the user's request.

CLI help distinguishes deterministic commands from chat authoring: `create` is
a chat workflow, not a newly implemented CLI scaffolder. Show the corresponding
`$alfred skills create ...` / OpenCode `/alfred skills create ...` examples.

### R4: Public catalog search and verified selection

Add `alfred skills search <query> [--limit <n>] [--json]`. Search does not require
harness or scope selection, writes no skill/receipt/config, and accepts neither
`--apply` nor mutation flags. Require a nonempty query of 2–200 characters;
limit defaults to 10 and ranges from 1 to 20. Multiword queries may be supplied
as one quoted value or normalized positional words. Output identifies the
catalog, query, retrieval time, and returned source links.

Use built-in fetch against the public endpoint used by the official Vercel
skills CLI: `https://skills.sh/api/search?q=<encoded-query>&limit=<n>`. The
[source implementation](https://github.com/vercel-labs/skills/blob/main/src/find.ts)
uses this unauthenticated endpoint; a bounded live probe returned HTTP 200 on
2026-10-18. The separate versioned catalog API requires authentication and is
not required here. Do not install `skills`, search for tokens, send existing
credentials, or inherit a remote endpoint from arbitrary environment variables.

Use a fixed HTTPS origin, bounded timeout/body size, safe redirects if needed
only within that origin, and injected transport in tests. Validate the response
shape and each normalized result. The observed envelope is
`{query, skills: [{id, source, skillId, name, installs}], count, ...}`. Require
a bounded `skills` array; validate `source` as a GitHub owner/repository pair,
`skillId` as a safe name, and optional `installs` as a nonnegative safe integer.
The upstream CLI also supports records without `skillId`: derive it only when
`id` has the exact `source + "/"` prefix followed by one safe name component.
Reconstruct catalog/repository links from validated components rather than
trusting returned URLs. Ignore extra timing/search fields. Return name, stable catalog id, skill slug,
GitHub owner/repository when valid, catalog page URL, and reported installation
count when present. Strip/reject control characters in rendered metadata. Do
not turn malformed service responses into empty results; distinguish no matches
from unavailability, rate limits, and unsupported source types. A graceful
failure can link the public catalog search page; never fabricate suggestions.
Installation counts are catalog-reported data, not quality or safety evidence.

Search metadata is discovery, not verified provenance or an installed version.
Selecting a result only identifies a candidate. Resolve its source with the
existing GitHub snapshot code before previewing an installation.

Add `--name <skill-name>` as a separate repository skill selector for
`add`/`install`. It is mutually exclusive with `--skill <directory>`; the latter
retains its existing directory-path meaning. For GitHub name selection:

1. Resolve the requested ref to one immutable commit and inspect that tree.
2. Find bounded `SKILL.md` candidates and parse frontmatter using the existing
   metadata validator, without executing or adopting their instructions.
3. Require exactly one valid package whose declared name equals the selected
   slug/name. Zero matches yields an actionable no-match result; multiple
   matches list paths and require `--skill` to disambiguate.
4. Acquire the complete selected package from that same commit, preserving
   current size, tree, blob-integrity, and path checks.
5. Record the actual resolved directory and commit in the existing receipt.

Keep a bounded metadata scan and fail clearly if repository size or request
limits prevent establishing uniqueness. Do not infer the directory from a
skills.sh slug or take its content hash as a Git revision. After installation,
updates use the recorded concrete skill path; they do not repeat catalog search.
Do not persist a new catalog identifier as authoritative source provenance.

### R5: Create means useful conversational authoring

`$alfred skills create <idea>` (or the OpenCode equivalent) creates a useful
skill draft with the user in the current conversation. Reuse the installed
`skill-creator` skill when available and applicable. If unavailable, follow the
canonical fallback authoring checklist; do not auto-install it or stop solely
because that helper is missing.

Establish purpose, concrete activation conditions, inputs, expected output,
constraints, and at least one realistic usage/validation example. Infer clear
context from the request and ask a short question only when a missing answer
changes the skill's intended behavior. Draft actual task-specific instructions;
do not claim an empty scaffold, generic filler, or unresolved TODOs is a finished
skill. Use scripts only for work that benefits from deterministic execution,
and route application-code authoring through the repository's developer role.

Write the portable draft under `<selected-project>/skills/<name>/SKILL.md` by
default, with needed relative resources beside it. An existing explicitly
selected authoring destination may be reused. Preserve unrelated existing
files and do not overwrite a same-name draft without scoped authorization.
Use atomic writes and validate frontmatter/name/description, nonempty useful
body, resource paths, and a concrete example. Reuse the manager's metadata/tree validation through the read-only
`alfred skills validate <directory> --json` helper and shared
`validateSkillDirectory` API. Require a nonempty body and reject mutation flags;
write no receipt/config and require no harness selection. A manager install
plan may additionally validate an intended installation, but creating a draft
alone must not require inventing a harness target.

Creation and installation are distinct outcomes. If the user requests only
creation, return the draft location and validation performed, without an install
receipt. If installation is also requested, call the existing manager using the
authored directory as local source, present its concrete preview, and apply
under R6. That successful installation creates the normal receipt. Do not edit
`.ai/skills/registry.json` automatically for a user-authored draft: that registry
is Alfred's packaged activation catalog, not machine installed state.

The CLI does not call a model to write skill content. Conversational authoring
uses the already-running agent under its policies; `provider_calls: 0` on manager
traces describes deterministic manager operations, not a claim that the entire
chat conversation consumed no inference.

### R6: Chat approval and state revalidation

Preserve current manager approval and integrity checks. Show a concrete preview
before live add/update/remove: selected source and commit/digest, destination,
harness/scope, action, affected files, and blockers. A search result, skill
invocation, or source selection is not authorization to apply it.

Reuse authorization already established in the current conversation when it
covers that exact operation and scope; do not ask the user to approve it twice.
For example, an explicit instruction to install the selected skill for this
project can authorize applying the resulting unchanged preview. A request to
search or merely inspect cannot. If approval is still missing, finish the
reviewable preview first and ask once. Global scope is never inferred from
project approval. This does not override tool approval or protected-path rules.

Because a chat preview and a later CLI apply may occur in separate processes,
add an optional `--expected-digest <sha256:...>` apply guard to the manager CLI
(and equivalent manager option). For add/update bind the reviewed candidate
digest; for remove bind the reviewed current installed digest. Apply must fail
before writes when the fresh plan differs. Pin a reviewed GitHub candidate to
its full commit when applying from chat so a branch advance cannot silently
change the installed revision. Preserve the user's original update-ref intent
in the receipt rather than accidentally converting branch tracking to a commit
pin merely because the chat needed a stable approval. Use a separate optional
`--expected-commit <full-commit>` apply guard for GitHub sources: resolve the
original requested ref and fail if it differs from the reviewed commit. Do
not redefine `--ref` semantics. Expected guards are meaningful only with apply
and must reject malformed digests/commits before source acquisition.

Use the existing in-process plan/apply stale-state checks as well. The chat skill
must compare source, actual path, scope/harness, and operation to the review;
no new persistent approval server or plan storage is needed. On changed state,
show the updated preview and require only the additional authorization needed
for the changed scope/content.

### R7: Observability and responsibility

Keep deterministic manager events at `provider_calls: 0`. Search returns a
read-only `skill_catalog_search` trace/result with query/catalog, status, count,
and network-use evidence; omit downloaded contents and credentials. Chat skill
instructions preserve the existing task classification, permission, skill-load,
delegation, and provider-request decision trace conventions rather than creating
a separate agent policy. Approval evidence refers to the current user instruction
or confirmation; never fabricate a grant from the skill's own prose.

Architect owns this specification only. Developer owns the canonical Alfred
skill/metadata, registry entry, adapters, manager search/alias/selector/guard,
CLI and documentation, and required runtime allowlist changes. QA owns relevant
regression/evaluation cases and tests in coordination with developer. Parent
Orchestrator owns continuation classification/delegation/permission traces,
integration, checks, PR update, and user-facing capability explanation. No
specialist rewrites another specialist's files or edits real protected roots.

## Completion criteria

- [x] Canonical skill routes all five requested chat actions, plus info/update.
- [x] Codex previews include the `$alfred` skill with default invocation policy, without a
      false claim that native `/alfred` is registered there.
- [x] OpenCode previews include the native `/alfred` command and canonical skill.
- [x] Runtime packaging and existing approved setup deliver the new artifacts.
- [x] `add` exactly reuses install, while search remains read-only and dependency-free.
- [x] Search distinguishes empty results from service errors and links real sources.
- [x] Selected catalog names resolve uniquely at an immutable GitHub revision;
      ambiguous/no-match cases never install a guessed directory.
- [x] Chat create produces and validates useful authoring artifacts, with receipts
      created only after requested/authorized installation.
- [x] Existing approval is reused without double confirmation; search/selection
      alone never authorizes writes, and reviewed-content guards reject changes.
- [x] Fixture-based CLI/manager, preview, and packaging tests pass without live
      user configuration writes or provider calls from deterministic code.

## Validation evidence

Independent deterministic validation passes: 136 skill-manager tests, three
synthetic adapter integration tests, and 27 existing CLI/packaging tests
(166 total), plus syntax and whitespace checks. The exact commands, source
snapshot, fixture hashes, and limitations are recorded in
`.ai/observability/generated/issue-227-skills-chat-qa.json`.
Production review and documentation review report no unresolved findings.

Two fresh independent conversational scenarios passed QA audit, separately
from the deterministic test count. Create produced a useful meeting-minutes
draft that validated without installation receipts. An authorized apply used
the reviewed digest, rejected changed source content with `E_STALE_PLAN`, and
returned an updated preview without installing or following instructions in
the changed source. Evidence hashes and audit limits are in the QA trace.
These isolated source-CLI scenarios do not establish native host activation.

Local validation uses injected public-catalog/GitHub transport and synthetic
harness roots. No actual harness configuration was activated, dependencies
installed, eval baselines changed, or full production release archive built.
Full root checks and existing adapter integration suites were not executed
locally because they import protected actual core/harness sources. Changed
runtime assets are covered by an actual archive-builder fixture using the
relevant production allowlist patterns.

## References

- `.ai/execution/skill-lifecycle.md`
- `.ai/skills/registry.json`
- `packages/skill-manager/src/{cli,index,model,sources}.js`
- `packages/codex-adapter/src/runtime.js`
- `packages/opencode-adapter/src/runtime.js`
- `scripts/setup/bridge.mjs`
- `packaging/runtime/allowlist.json`
