---
id: workspace-product-packages
owner: developer
issue: 240
source-revision: 1e8c624d65e9814549d8604db181d716bc0dd0f4
---

# Independent Alfred product capabilities

## Requirements

- Import the reviewed tracked Workspace snapshot as `packages/workspace`, preserving provenance and the original repository/history.
- Alfred offers Workspace, Memory and Agent Harness. Each capability has its own public entrypoint, state and dependencies; no capability imports or starts a peer implementation implicitly.
- `packages/cli` is the composition root. It resolves only the selected capability. Optional MCP/HTTP/session integrations are explicit and use public contracts.
- Preserve Workspace's existing SessionPort/SessionAdapter injection and compatibility adapter. Do not claim unsupported ACP execution.
- Preserve local-only Memory serving and existing tenant/workspace binding semantics; these are distinct from the Workspace product.
- Preserve legacy global CLI commands and setup/update behavior. Historical `coding`, `memory` and `full` map to Agent Harness, Memory and Agent Harness + Memory respectively. Workspace is never added to old selections automatically.
- New setup selections expose all three capabilities independently. Product component preferences and harness installation receipts remain separate.
- Preserve review/consent, partial recovery, secret exclusion and downgrade guards from setup1.1.0.
- Verify isolated capability entrypoints with peer families absent, package-relative Workspace assets, meaningful existing UI/PTY tests and shipped runtime behavior.
- Workspace in Homebrew is not complete until the installed package can create a real PTY; distribution must handle native binaries, dependency closure and executable modes explicitly.

## Public CLI contracts

- `packages/cli/scripts/alfred.mjs` exports `run(args, env)` and implements `alfred workspace`, `alfred memory`, `alfred harness`, `alfred setup`, `alfred version`, and legacy aliases. Dispatch is lazy.
- `packages/workspace/scripts/cli.mjs` exports `run(args, env)` and backs `alfred-workspace`. It owns Workspace serve/start/help/version behavior and package-relative build paths.
- `packages/memory-server/scripts/memory.mjs` exports `run(args, env)` and backs `alfred-memory`. It owns Memory commands only, without loading the product CLI, Workspace or Agent Harness.
- `packages/agent-harness/scripts/cli.mjs` exports `run(args, env)` and backs `alfred-agent-harness`. It delegates runtime/skills/profiles to existing family implementations without Memory/Workspace imports.
- `packages/cli/scripts/setup.mjs` owns the product setup launcher. Deprecated Memory script paths may forward for compatibility, but standalone Memory never imports those shims.
- Process entrypoints invoke `run(process.argv.slice(2), process.env)` only when executed directly. Imports do not exit the host process.

## Ownership

- Product developer: CLI/Harness public entrypoints, Memory dispatch compatibility, product setup and Go UI, root scripts, boundary tests and this specification.
- Workspace developer: `packages/workspace/**`, import/provenance, public CLI, application/build/test paths and source tests.
- Distribution developer: packaging, native dependency strategy, build/verifier scripts, workflows and lockfiles.
- Documentation specialist: public documentation, architecture/product language and optional composition guidance after contracts stabilize.

## Validation gates

1. Each capability responds independently when peer package directories are absent; product help/version do not load any capability.
2. Explicit composition uses injected/public contracts; no implicit tenant creation, credential discovery, Memory proxy or harness startup.
3. Namespace commands and legacy aliases retain argument/error/exit behavior.
4. Every nonempty combination of the three setup capabilities is representable; old selections/receipts remain valid and exclude Workspace.
5. Workspace builds, typechecks and runs its relevant existing tests; assets resolve outside the source cwd.
6. Memory loopback and setup/update1.1.0 regressions remain green.
7. Runtime archive and installed Homebrew formula validate entrypoints and actual PTY execution on supported platforms.

No provider requests, original-source edits, live user configuration changes or dependency installations in the user workspace are part of development.

## Product implementation and verification

- Setup accepts optional `selection.components` with `workspace`, `memory`, `harness`. All seven nonempty combinations are supported; product flags use `alfred setup --components=workspace,memory,harness`.
- Approved preparation saves `.alfred/setup/components.json` using schema `alfred.setup.components/v1` with project, runtime version and chosen components. Preview names the preference write. Discovery, version checks and preview remain write-free.
- `.alfred/setup/installation.json` keeps the existing `alfred.setup.installation/v1` contract. Component preferences never imply installed harness files; discovery supplies separate `integrationDefaults` from the verified receipt for updates.
- Selecting multiple capabilities only prepares those families. It does not connect MCP, copy credentials, create tenants, configure a SessionAdapter, or start services between families.
- Product and standalone process entry guards resolve executable symlinks; the product dispatcher sets `process.exitCode` so long-running Workspace services remain alive.
- Verified: 79 Node setup/composition tests, 12 existing Memory CLI/loopback tests, suite installer validator, product/setup syntax checks, shell syntax and Git whitespace checks.
- Go UI tests pass offline with a temporary modfile using the already cached `golang.org/x/sync v0.3.0`. The repository remains pinned to v0.1.0; that exact dependency is absent locally, so exact-lock Go validation is a required CI gate, not claimed complete here.
- Workspace build/application tests and distributable native PTY/archive/Homebrew gates are owned by the other implementation scopes and must be reported independently before release.

- Post-freeze validation maintenance: ChatGPT contract tests now assert generic Orchestrator persistence with unchanged evidence, consent, opt-out, secret and no-bypass safeguards; the Memory operation mapping is tested only as an explicitly configured optional connection. Two stale documentation assertions expected cloud onboarding even though the README already documented local-only Memory at base `5a9cf95852d4b149ed3ce1b30989bb1cbe771a94`. Those assertions now require the existing local/API-key/MCP onboarding and rejection of remote exposure. The complete ChatGPT contract suite passes 13/13; no runtime or documentation behavior was changed by this test maintenance.
- Alias audit at the same base found no global `alfred workspace` or `alfred workspaces` dispatch cases or matching Memory command scripts. The new Workspace namespace does not replace a prior Memory command.

- Reviewer P2 follow-up: explicit `alfred setup --components=… --apply` now snapshots product preferences in the caller's original project, discloses the preference write, and atomically saves after the installer exits successfully. It honors the last `--apply`/`--dry-run`, leaves help/preview/failure/cancellation unchanged, rejects a forced TUI with explicit choices, and refuses to overwrite concurrent preferences. Harness receipt schema and contents remain separate. Validation: all 20 directed tests in `scripts/setup/components.test.mjs`, `scripts/setup/launcher.test.mjs`, and `scripts/alfred-setup.test.mjs` pass, including real Homebrew CLI apply followed by discovery in isolated HOME/project fixtures; syntax and whitespace checks pass.
