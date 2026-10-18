# Skill manager

`alfred skills` inventories skill packages on disk and manages installation,
updates, and removal with explicit approval. Each managed installation has a
receipt that records its source, revision, content digest, and destination.
This operational package does not change Alfred's skill activation catalog or
core permission rules.

From this source checkout, invoke the dispatcher directly. Changing the source
does not update an existing Homebrew installation or publish a release:

```sh
node packages/memory-server/scripts/alfred.mjs skills --help
```

## Inspect installed skills

```sh
alfred skills list
alfred skills list --harness codex --scope project --json
alfred skills info tdd --harness codex --scope project
alfred skills list --cwd /path/to/project
```

`list` and `info` are offline and do not create receipts. By default they inspect
both supported harnesses and both scopes. Same-name installations in different
locations remain separate. Output identifies scanned roots and coverage.
An inventory row means content was observed on disk; it does not prove the
running harness loaded that skill. A new harness session may be needed after
changes.

| Management / integrity | Meaning |
| --- | --- |
| `managed` / `intact` | The package matches its recorded digest. |
| `managed` / `modified` | Files, file contents, or executable modes changed. |
| `managed` / `missing` | A receipt exists, but its skill directory is absent. |
| `unmanaged` / `unknown` | A skill exists without an Alfred installation receipt. |
| `invalid` integrity / diagnostic | Metadata, links, access, or receipt state prevents safe inspection. |

A skill's optional top-level `version` in `SKILL.md` frontmatter is shown as
**declared version**. Its immutable revision is a Git commit when available and
a SHA-256 digest of the complete package, including resources and executable
modes. The full Git commit is retained even when display is abbreviated.
The Alfred release and registry schema versions are not skill versions.
Unmanaged skills have unknown source/history; their observed digest only
identifies the content currently present.

## Install, update, and remove

```sh
# Preview one local skill directory containing SKILL.md.
alfred skills install ./skills/tdd --harness codex

# Apply that selected operation.
alfred skills install ./skills/tdd --harness codex --apply

# Select one directory in a public GitHub repository.
alfred skills install https://github.com/owner/repo --skill skills/tdd --ref main --harness codex

# Preview an update from the recorded source, then apply explicitly.
alfred skills update tdd --harness codex
alfred skills update tdd --harness codex --apply

# Preview and apply removal of one managed installation.
alfred skills remove tdd --harness codex
alfred skills remove tdd --harness codex --apply
```

Every mutation previews by default. The plan identifies the source, destination,
current and candidate revision, affected files, and blockers. `--apply` authorizes
the selected operation; `--dry-run` takes precedence if both flags are supplied.
State and candidate content are revalidated before applying. Changed state
invalidates the plan. Updates and removals require a managed, intact target;
modified, missing, and unmanaged targets are blocked. There is no force-overwrite
or force-delete option.

Mutations default to project scope. Choose `--scope global` explicitly for global
changes. Use `--harness codex|opencode` whenever discovery cannot identify exactly
one destination; the inferred harness is always shown. All commands accept
`--cwd`, `--scope`, `--harness`, `--json`, and `--help`; mutations also accept
`--apply` and `--dry-run`.

Local sources are copied as snapshots and recorded by absolute source path and
digest. Updates reread that path; an unavailable source blocks the operation.
For GitHub, `--skill` selects a repository-relative directory (use `.` for the
repository root). `--ref` defaults to `HEAD`. A branch or tag is resolved to a
full commit before content is fetched. Updates follow the recorded requested
ref; a commit pin remains pinned unless `update --ref <new-ref>` explicitly
changes it. GitHub acquisition requires network access, but never a
model-provider call. Private repositories and authenticated source URLs are
unsupported; the manager does not search for credentials. Downloaded scripts
and hooks are never run.

## Native destinations and inventory coverage

| Harness | Project scope | Global scope |
| --- | --- | --- |
| Codex | `<cwd>/.agents/skills` | `<home>/.agents/skills` |
| opencode | `<cwd>/.opencode/skills` | `<config-home>/opencode/skills` |

`config-home` is absolute `XDG_CONFIG_HOME`, or `<home>/.config` when unset.
A relative override is rejected. `CODEX_HOME` does not redirect this Codex skills
root. `OPENCODE_CONFIG_DIR` does not replace these native installation targets.
Project scope follows the selected working tree, including a Git worktree.
When the working directory is the home directory, an aliased physical Codex
installation is listed once with its recorded scope. Mutations must explicitly
select `--scope global` or a separate project with `--cwd`: project mutations
from the home directory are rejected because their state file would collide
with global state. Alfred never silently changes a project mutation to global.

Coverage is limited to these physical locations. Custom configuration roots,
ancestor-project inheritance, legacy and `.claude` compatibility roots,
admin/system bundles, and plugin caches are outside this inventory. OpenCode
can also discover `.agents` skills; that does not create a second physical
installation. Native management target labels do not establish runtime name
precedence or exclusive harness visibility. Pi and other harnesses are not
supported by this package.

## Existing setup skills and adoption

Skills installed before receipts were introduced appear immediately as
`unmanaged`. Alfred does not infer their source or installation version from a
matching name or the current catalog. To manage one, explicitly install from a
chosen source whose entire content and executable modes match the existing
package:

```sh
alfred skills install /path/to/matching-source/tdd --harness codex
alfred skills install /path/to/matching-source/tdd --harness codex --apply
```

An exact match previews an `adopt` action. Applying it records management and
the source match observed now without rewriting the skill files. The original
installation date remains unknown; `managedSince` records adoption. Different
content blocks adoption. The installed target itself cannot serve as its own
update source. For setup-generated skills with transformed frontmatter, use
the corresponding exact generated preview as the source. Canonical source with
different frontmatter does not qualify. There is no automatic bulk migration.

## State and operation traces

Project receipts live at `<cwd>/.alfred/skills-lock.json`; global receipts live
at `<home>/.alfred/skills-lock.json`. Identity includes harness, scope, and skill
name. These files describe machine installation state, separately from
`.ai/skills/registry.json`, which is the lazy activation catalog. A corrupt
lockfile produces a diagnostic and is not silently replaced.

Complete skill packages are staged and renamed with receipt coordination and
rollback. Unsafe paths and links are rejected. Source-control internals
(`.git`, `.hg`, `.svn`) are excluded from source snapshots; adding such files to
an installed package still marks it as modified. Source limits are 1,000 files,
5 MiB per file, 25 MiB total, and 30 directory levels.

Competing mutations fail while a scope's `skills-operation.lock` guard exists.
After an interrupted process, inspect the guard and hidden transaction backups
before manually recovering or removing the guard. An explicit recovery error
identifies preserved backups when automatic rollback cannot safely finish.

Mutation results carry `skill_manager_operation` traces with approval, source,
target, digests, status, and `provider_calls: 0`. Apply operations persist traces
under the selected scope's `.alfred/observability/`. Read and preview operations
do not modify live skill packages or receipts.

The implementation contract is
[the skill lifecycle specification](../../.ai/execution/skill-lifecycle.md).
