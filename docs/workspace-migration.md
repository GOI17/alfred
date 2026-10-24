# Workspace repository migration

Issue #240 moves the published `GOI17/alfred-workspace` source into Alfred as
`packages/workspace` (`@alfred-labs/workspace`). The source checkout and its Git
history remain intact. This operation does not delete or archive the original
repository, move private runtime state, migrate credentials, or start services.

## Pinned source

| Item | Value |
|---|---|
| Repository | `GOI17/alfred-workspace` |
| Commit | `1e8c624d65e9814549d8604db181d716bc0dd0f4` |
| Tree | `2683a7993053da9cd3c81293869ba214cdd079ba` |
| Tracked source snapshot | 175 files |
| Destination | `packages/workspace/` |
| Provenance | `packages/workspace/upstream-snapshot.json` |

The provenance manifest records the pinned Git blobs, file hashes, and migration
transformations. This is a source snapshot import, not a merge of the original
repository's Git history. The original history remains available in the source
repository. Source files did not include a project LICENSE/NOTICE; migration does
not invent licensing terms. Dependency notices remain governed by distribution.

## Running the integrated package

Build the package according to its [README](../packages/workspace/README.md), or
install a published Alfred runtime that includes Workspace. Then run:

```sh
alfred-workspace serve --host 127.0.0.1 --port 4310 \
  --data-dir /absolute/path/to/workspace-state
# Same capability through the product CLI:
alfred workspace serve --port 4310 --data-dir /absolute/path/to/workspace-state
```

Use an explicitly chosen state directory outside the package. The imported
source's legacy default remains a compatibility behavior; the migration does
not silently move an existing state directory. Static web assets resolve relative
to the built package, independently of the invoking shell's working directory.
Memory and Agent Harness are optional and are not started by either command.

Workspace's existing `SessionPort`/`SessionAdapter` contract is retained. Runtime
integration is explicit. No ACP backend or Alfred Agent Harness adapter is
claimed by this migration. The package's legacy runtime remains available as a
compatibility adapter and does not become a cross-package dependency.

## Existing Alfred setups

The 1.1.0 CLI does not include Workspace. Upgrade to a release that
includes the package, then select Workspace in `alfred setup` (or use
`--components=workspace` for its selection). Historical `full` still means
Agent Harness + Memory. Upgrading never silently adds the third capability.
Existing integration receipts remain compatible and saved harness choices are
reused for project updates.

Selecting Workspace alongside Memory or Agent Harness does not connect their
services, credentials, MCP settings, or session runtimes. Review each optional
connection separately. A Memory filesystem workspace binding is unrelated to
the Workspace application; its IDs and database tables do not change.

## Distribution gates

Preparing source does not publish a Homebrew package. Workspace enters release
artifacts only after packaged HTTP/static-asset checks and a real terminal spawn
and exit pass on macOS x64/arm64 and Linux x64/arm64. The terminal dependency is
required and bundled per target. Playwright browser engines are optional and
must be installed explicitly when browser tools are used. Homebrew installation
does not download browsers.

See [runtime packaging](../packaging/runtime/README.md) and
[Homebrew publishing](../packaging/homebrew/README.md) for the release gate and
artifact provenance. Tests of a source checkout are not evidence that an
already installed 1.1.0 runtime contains Workspace.
