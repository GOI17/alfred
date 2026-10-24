# Workspace migration validation

Validated on macOS with Node 26.12.0 and the existing, pinned upstream dependencies.
No dependency installation or provider/Cloudflare connection was performed by this
package task. Server and browser tests used temporary HOME/state/project fixtures,
`ORCA_BACKGROUND_LAUNCH=1`, `/bin/sh`, and the existing Playwright browser cache.

| Check                                                                     | Result                                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| TypeScript `tsc --noEmit`                                                 | Pass                                                                     |
| Vite build with runner config loader + server/declaration emit            | Pass                                                                     |
| Original Vitest suite                                                     | 28 files, 179 tests pass                                                 |
| Standalone CLI tests                                                      | 4 pass                                                                   |
| Built/development package + public runtime contract tests                 | 4 pass                                                                   |
| Production application E2E, desktop and phone                             | 6 pass                                                                   |
| Chat/UI/Git/harness/notification/QR E2E, desktop, phone and WebKit iPhone | 74 pass; 1 existing skip for desktop-only floating controls on phone     |
| ESLint on all added/adapted JS/TS files                                   | Pass                                                                     |
| Full imported ESLint baseline                                             | 25 existing errors in 16 unchanged files; see `validation-baseline.json` |

The package smoke tests copy compiled artifacts and the public entrypoint into an
isolated fixture with no peer products. They exercise help/version without runtime
dependencies, binary symlinks, imports without startup, production and development
assets from an external directory with spaces, real HTTP authentication, default
state outside the installed package, orderly shutdown, and rejection of internal
state paths (including symlink aliases), invalid ports and incomplete TLS options.
The injected `SessionAdapter` test exercises public `createApp` without legacy
settings/tool bindings or peer product implementations.

The final development asset check additionally models pnpm's individual dependency
links and fetches both font packages over Vite. Two desktop/phone composer geometry
cases passed after narrowing the development allowlist to the package and those
font directories. The unchanged production bundle was rebuilt successfully with
the runner loader, which avoids Vite's temporary config bundle in dependencies.

## Changes to existing test fixtures

- Six production UI cases follow the snapshot's current Add space action, project
  action menu, Git History view and workspace picker. Real project/worktree
  creation, deletion, panel behavior and folder preservation remain asserted.
- Chat/UI cases share one real session. QR/login cases start unauthenticated;
  notification cases clear and restore the session to retain pre-login checks.
  The production limit of ten login attempts per minute remains unchanged.
- Responsive assertions follow the original CSS: the desktop message index and
  popup action are hidden on phones; reading position, all messages, context and
  layout remain checked. Docked chats become visible after the last floating chat
  returns to the normal layout. No new skips or production UI changes were added.

The original 175-file source snapshot remains recorded in `upstream-snapshot.json`.
At the migration checkpoint, 150 original files remain byte-identical, 23 have
monorepo/test/documentation adaptations, and the two nested pnpm files are replaced
by the monorepo configuration and lock. The source worktree is clean at the pinned
commit/tree. The source repository and its history were preserved.

Cross-platform native PTY archives, the universal runtime and Homebrew validation
belong to the distribution task; this report does not claim those checks passed.
