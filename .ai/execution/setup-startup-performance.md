---
id: execution/setup-startup-performance
description: Reduce measured setup startup latency without weakening setup safety
owner: developer
phase: verified
issue: 225
---

# Setup startup performance

## Scope and ownership

Single worktree issue-225-setup-startup-performance from main3846080 (0.7.4).
Developer1 owns packages/setup-tui/**; integration developer owns launcher,
focused regression integration and this spec. Main coordinates QA and review.
No core/harness/protected reads or changes are authorized for this task. No
installed Alfred or global config changes. Existing modules may be copied read-only
to isolated task caches. User approved downloading only the missing pinned
golang.org/x/sync@v0.1.0 and golang.org/x/text@v0.3.8 into the task temp cache;
Developer1 owns downloads/builds, with no toolchain installation or global writes.

## R1: Measure before claiming improvement

QA records installed0.7.4 PTY process-start to first meaningful menu, response
to navigation and cancellation. Compare candidate with same terminal dimensions,
environment and terminal-response behavior; report individual samples, median,
maximum and sample count. Separate terminal queries from Node startup, binary
integrity verification, backend discovery and first render. Baseline numbers
are pending QA; suspected terminal color timeout is not yet a timing result.

## R2: Bounded implementation

Remove unnecessary blocking terminal discovery only where measured and confirmed.
Keep pinned Bubble Tea/Lip Gloss versions, Darcula presentation, NO_COLOR and
supported terminal behavior. Preserve launcher digest/native-header validation;
do not trade away integrity or add caches merely to improve a benchmark.
Backend discovery currently reads package metadata and command availability only;
it must not invoke installer/preview/apply during startup.

## R3: Safety and regression budget

Keep explicit one-use confirmation, paste rejection, cancellation, EOF and signal
handling, terminal restoration, resize and small-screen usability unchanged.
Keep explicit legacy/non-TTY paths and offline bundled operation. No domain or
provider behavior changes. No baseline edits.
Acceptance budget proposed by QA for controlled local PTYs: meaningful first menu
median below1s and each sample below2s; navigation and cancellation retain
existing functional behavior. Assert no blocking OSC color
queries as a deterministic regression. Timing
assertions belong in controlled PTY verification, not flaky shared-runner unit tests.

## Completion

- [x] Issue, isolated worktree and scoped source inventory.
- [x] QA baseline and final measurable budget recorded.
- [x] Minimal optimization and deterministic regression coverage.
- [x] Matched candidate PTY measurements and safety checks pass.
- [x] Reviewer acceptance; draft PR evidence prepared.

## References

- .ai/execution/wave-setup-tui.md
- packages/setup-tui/main.go
- packages/memory-server/scripts/setup.mjs
- scripts/setup/launcher.test.mjs

## Initial measured baseline (QA, pending completed matrix)

Installed0.7.4, xterm-256color truecolor silent PTY: first useful menu10085.377ms;
OSC10 at58.224ms, OSC11 at5063.414ms. screen-256color truecolor:146.103ms,
no queries. Five version samples median45.336ms (45.023..46.645); five direct
discovery samples median46.908ms (45.527..47.221). These isolate the observed
large delay to terminal interaction rather than justify weakening launcher checks.
Responsive-terminal pilot timed out at18s; QA/Go owner investigate competing
input readers before final claims. Full matched matrix remains required.

## Actual CLI regression guard

The existing macOS/Linux packaged-runtime CI smoke now keeps a silent
xterm-256color PTY and rejects OSC10/OSC11/DSR queries before the useful menu
(header, Coding option and navigation help). It logs first-menu elapsed time
without a tight CI timing assertion; the existing15s deadlock watchdog, Ctrl-C,
terminal attributes and alternate-screen restoration checks remain intact.
This exercises the actual CLI/main wiring, not only the terminal helper.

The exact embedded Python guard was tested locally against matched full-launcher
fixtures:0.7.4 failed on OSC10; candidate passed at97.916ms with restoration.
Both fixtures retain installed dispatcher/launcher and identical installed bridge
source, changing only its fixture root binding to the real installed root; native
binary and matching integrity manifest are the only variant difference. An initial
symlink-based fixture failed bridge entry detection; those invalid samples were
excluded and both fixtures corrected before this result. No installed files changed.
Logs: /var/folders/7f/gv_2mjgx69lfdx78fr541snm0000gn/T/alfred-225-ci-guard-final-wjr3xb2w.

## Final QA and focused verification

QA report: /tmp/alfred-startup-perf/comparison.md and comparison.json.
Candidate full-launcher fixtures:25 valid samples across five terminal cases,
all pass, no OSC/DSR queries, cancellation exit0 and isolated HOME/cwd empty.
xterm-256color/truecolor silent: installed0.7.4 n5 median10119.166ms
(range10087.691–10124.535); candidate n5 median107.373ms
(range105.179–329.591). screen-256color/truecolor: baseline107.073ms vs
candidate107.591ms medians. Responding xterm candidate109.022ms median,
while installed baseline had3/5 timeouts. These are environment-specific results.
Matched direct-Go n5 medians: old10041.583ms vs candidate56.096ms.
Candidate SHA256 e777258133ae9237093f231bac73c3fd2e24d9edf1cce3bd0b921fb720e4b8a1.
Offline Go build, race tests and vet PASS; launcher integrity test1/1 PASS;
Node syntax and diff whitespace checks PASS. Source and actual-CLI CI guard
review accepted without findings. CI will perform full packaged runtime smoke
on macOS/Linux; no local full archive rerun or protected-source access claimed.
