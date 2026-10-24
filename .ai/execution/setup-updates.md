---
id: setup-updates
description: Reviewed CLI and project integration updates from the guided setup entry screen.
owner: developer
phase: issue-237
issue: 237
---

# Setup updates

## Requirements

- R1: Opening interactive setup shows CLI and project integration versions. Local discovery renders before an asynchronous, bounded, credential-free check of the canonical stable release and Homebrew tap. Offline/error/development states never prevent continuing setup.
- R2: A review and one-use explicit confirmation precede Homebrew upgrade. The launcher restores the terminal, runs fixed argument vectors, verifies the resulting version, and relaunches the new runtime with the original project cwd. Source installations cannot invoke a misleading Brew upgrade.
- R3: Successful initial activation records project identity, version, selected harnesses and managed artifact baselines atomically. Updates reuse these choices and generate only harness previews, without running Memory/profile preparation or repeating the wizard.
- R4: Project updates compare recorded baselines with current files and the new generated contents. Preserve unrelated Codex instruction text and OpenCode settings. Edited/deleted managed files, unsafe paths, conflicting legacy evidence and changed approval snapshots fail closed. Removed artifact paths block with an explicit retirement conflict; this version does not silently retain obsolete artifacts while claiming a completed update.
- R5: Legacy1.0.1 installations may be adopted only from project-local manifests with verified source hashes and matching installed artifacts/managed blocks. Global trace files and guessed filenames never establish ownership. Review explicitly identifies adoption.
- R6: Separate a durable attempt journal from the final receipt. Partial writes do not advance the complete integration version. Retry recognizes only exact outputs from the approved attempt, and detects later edits. Do not copy unrelated configuration or secrets into receipts/journals.
- R7: Cancellation/check-only actions never run Brew or write live harness files. Runtime and integration outcomes are independent. CLI current/project old remains updateable. Restarting the harness remains necessary after changed integration files.
- R8: Deterministic regression tests inject release transport/Brew, exercise actual artifact changes, preserve zero external network in packaged smoke, validate compact Go screens, and cover current/offline/unsupported/partial/conflict/replay cases.

## Protocol

Schema remains alfred.setup/v1. Discovery adds project status/version/text/canUpdate and resume. check-update returns status/text/currentVersion/latestVersion/canUpgrade. runtime-preview and project-preview return review text and one-use previewToken; their confirmation operations are runtime-approve and project-apply. project-decline discards consent. runtime_upgrade_approved exits the Go UI with20; only the parent launcher performs Brew and relaunch. Resume opens a fresh project review and never grants write consent.

## Completion conditions

- [x] Version discovery and reviewed Homebrew upgrade/relaunch implemented.
- [x] Initial receipts, safe legacy adoption, project synchronization and recovery implemented.
- [ ] Startup Go UI and exact approval protocol covered by regression tests.
- [ ] Runtime packaging includes new modules; packaged activation/update passes offline smoke.
- [ ] User documentation describes one-time bootstrap from1.0.1 and future setup updates.

## References

- .ai/execution/setup-harness-activation.md
- scripts/setup/bridge.mjs
- scripts/setup/activation.mjs
- packages/memory-server/scripts/setup.mjs
- packages/setup-tui/

Local validation: setup68/68, Homebrew42/42 and adapter chat-skill3/3 pass; installer validation including PTY, syntax and installation-policy validation pass. Go execution and full archive smoke remain CI gates.

Review regressions: approved legacy baseline/selection survives partial writes and failed receipt persistence; later edits remain conflicts. Advisory release checks preserve a pending project approval in either request order. Final receipt/journal snapshots protect concurrent state, and an older stable CLI cannot downgrade recorded or partially applied integration versions.
