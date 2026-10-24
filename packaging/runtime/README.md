# Selected runtime build inputs

`allowlist.json` selects the neutral CLI, independent Workspace, Memory and
Agent Harness entrypoints, public package metadata, assets and module copies.
`package.json` and `package-lock.json` pin the production closure and a separate
build-only toolchain. `npm ci --omit=dev --ignore-scripts` stages only production;
`npm ci --include=dev --ignore-scripts` stages the reviewed compiler/native tools.
Both stages live outside the checkout. Neither runs package lifecycle scripts.
No package manager runs during Homebrew installation.

Workspace assets must be compiled before packaging:

```sh
node scripts/build-workspace.mjs --dependencies /absolute/build-stage/node_modules
```

The build helper accepts an already installed toolchain, temporarily links it
only if the Workspace package has no dependencies, and removes its own link.
It refuses to replace existing dependencies. Source development can use the
existing Workspace dependencies by omitting `--dependencies`.

## Native terminal artifacts

The universal archive contains `node-pty@1.1.0` N-API binaries for Darwin/Linux
x64 and arm64. Darwin binaries and `spawn-helper` come from the npm package whose
integrity is pinned in the reviewed lock. The archive preserves `spawn-helper`
mode `0755`; `.node` libraries use `0644`. Declared npm bin scripts retain `0755`.
Windows prebuilds and development build outputs are excluded.

The pinned npm package does not contain Linux prebuilds. The reusable
[`workspace-native.yml`](../../.github/workflows/workspace-native.yml) workflow
builds natively on Ubuntu 22.04 x64 and arm64, using pinned `node-gyp@11.4.2`,
`node-addon-api@7.1.1`, and headers from the installed Node 24 toolchain. It never
downloads Node headers. Each binary must spawn a shell, return output, and exit
successfully before its artifact is uploaded. Linux uses glibc; musl Linux is
not a supported target. The native build environment establishes the glibc
compatibility floor (Ubuntu 22.04 / glibc 2.35).

```sh
node scripts/build-workspace-native.mjs \
  --dependencies /absolute/native-stage/node_modules \
  --source-revision <40-character-source-commit> \
  --output /absolute/native-artifacts
```

Both `linux-x64/` and `linux-arm64/` artifacts are required by
`build-runtime.mjs --workspace-native /absolute/native-artifacts`. Each contains
only `pty.node` and a manifest binding its hash, architecture, source revision,
production/build lock and dependency integrities. Stale, incomplete, symlinked,
tampered or wrong-architecture artifacts fail packaging. The combined provenance
is shipped as `packages/workspace/native-manifest.json` and inventoried by the
runtime manifest.

The Homebrew workflow extracts and runs the archive on all four architectures,
including real Workspace HTTP/assets, a PTY and commands with peer packages
absent. The smoke keeps the existing external-network guard and temporary HOME
and project state. Cross-compilation, unit fixtures or `--archive-only` do not
substitute for these execution gates. A local Darwin PTY check is not Linux
execution evidence.

Playwright's JavaScript is part of the production closure, preserving Workspace
browser tools. Chromium and WebKit binaries are optional separate installations;
ordinary Workspace startup and terminal tools do not require them. CI installs
both explicitly for the two browser test suites. No browser download occurs in
build lifecycle scripts or the Homebrew formula.

The Workspace import keeps its published Zod 4.6.7 dependency; Memory previously
shipped 4.4.3. The shared npm runtime closure uses 4.6.7 and the packaged Memory HTTP
and MCP CRUD gates verify compatibility before publication. The source pnpm lock
retains package-level peer resolutions. The source's pnpm 12 multi-document lock
was merged into the Alfred pnpm 10 monorepo lock; no nested lock is authoritative.

Follow [the Homebrew build guide](../homebrew/README.md) for staging and release
publication. The builder rejects traversal, symlinks, secret-like files and an
unexpected dependency closure. `SHA256SUMS` binds archive, inventory and formula;
the inventory records exact source and build inputs. Repeated identical inputs
produce identical bytes. Generated binaries and archives are never committed.

This migration is source work for a future release. It does not update existing
Alfred 1.1.0 installations or justify replacing historical release assets.

## Coordinated product release versions

Release Please updates `packages/cli`, `packages/agent-harness`,
`packages/workspace` and `packages/memory-server` package versions through JSON
`$.version` entries in the same root release. Each standalone CLI continues to
read its own metadata; no capability imports a peer to determine its version.
The initial imported versions remain unchanged during migration. Generated
release PRs and publication require all four versions to equal the root version,
using `ALFRED_VALIDATE_RELEASE_CANDIDATE=1 npm run validate:release-automation`.
Internal package versions are not included in this coordinated public contract.
