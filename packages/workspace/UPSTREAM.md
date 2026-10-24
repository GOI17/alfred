# Workspace import provenance

This package imports the tracked snapshot of
[GOI17/alfred-workspace](https://github.com/GOI17/alfred-workspace) at commit
`1e8c624d65e9814549d8604db181d716bc0dd0f4` (Git tree
`2683a7993053da9cd3c81293869ba214cdd079ba`, upstream package version `0.1.0`).

`upstream-snapshot.json` records all 175 original tracked files with their Git
blob IDs, modes, byte counts and SHA-256 hashes. It describes the input snapshot,
not the subsequent monorepo adaptations. Import used `git archive` from the
verified commit; no repository metadata, ignored local state or dependencies
were imported. The original repository and its history are retained separately;
its 11,289-commit history was not merged into Alfred. The source snapshot did not
contain a project LICENSE or NOTICE file; this import makes no new licensing
claim about the original source.

## Monorepo adaptations

- The package is named `@alfred-labs/workspace`; its standalone binary remains
  `alfred-workspace`. Package-manager metadata follows the root pnpm version.
- The nested pnpm workspace configuration is replaced by the monorepo's root
  configuration and the nested lockfile is integrated into the root lock; neither
  nested pnpm file remains.
- A lazy public CLI exposes help/version without loading runtime dependencies.
  Server startup is exported and guarded, so imports do not listen or open state.
- Production assets and development Vite configuration resolve relative to the
  Workspace package instead of the invoking process's working directory. Vite
  uses its runner config loader, keeps caches inside the package's ignored cache
  folder, and explicitly allows only the two resolved font packages as external
  static assets during development (including pnpm dependency links).
- Workspace state defaults to `~/.alfred-workspace`, with explicit namespaced
  configuration and legacy environment aliases. CLI startup rejects state inside
  the installed package. Test state/cache paths are isolated from source and
  dependency installations.
- Type declarations and public app/session contracts are included in builds.
  Two SDK-facing return types are annotated explicitly for portable declarations.
  Existing SessionPort/SessionAdapter behavior is preserved; peer Alfred product
  implementations are not imported or discovered automatically.
- The imported tests are retained. The older app E2E selectors now follow the
  existing Add space, workspace picker and project action menu, preserving the
  cancellation, real Git/worktree, panel and folder-preservation assertions.
  Responsive UI assertions also follow the original CSS: the desktop message
  index/window control are hidden on phones, and docked chats return after the
  last floating chat docks. Mobile reading-position and message-count checks
  remain active. Chat/UI cases share a real test session so the suite does not exhaust the
  unchanged production login limiter; QR/login cases still start unauthenticated. Additional CLI/package tests exercise lazy
  standalone entrypoints and serving a built package with peer products absent.
- The original notification settings helper checked mobile navigation visibility
  before workspace restoration completed after reload. It now waits for the app
  shell before choosing the sidebar action. A delayed-state regression retains
  the real UI flow and authentication assertions without timing sleeps or skips.

Generated build outputs, test reports, local state and dependency links remain
ignored. Native PTY distribution and monorepo-wide locks are reviewed separately
by Alfred's packaging workflow.

## Existing validation baseline

`validation-baseline.json` records 25 existing ESLint errors in 16 source files.
Each affected file is byte-identical to its original snapshot SHA-256. The rules
are type assertions (18), control-character regexes (3), maximum lines (1),
unused assignment (1), caught-error cause (1), and unexpected multiline call (1).
Adapted and added code passes ESLint; these original warnings were not suppressed
or repaired as an unrelated migration change. Test and build evidence is in
[MIGRATION-VALIDATION.md](MIGRATION-VALIDATION.md).
