#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  PHASES,
  createPathfinderState,
  previewModel,
  previewPageSize,
  recommend,
  render,
  serializeAssignments,
  transition
} from "./install-pathfinder.mjs";
import { decodeTerminalEvent, printableInputAction, sgrMouseAction } from "./install-app.mjs";

const defaults = recommend({
  current: {},
  harnessStatus: { opencode: "installed", "codex-cli": "not-installed", "codex-app": "installed", pi: "not-installed" }
});
assert.equal(defaults.decisions.edition, "coding");
assert.deepEqual(defaults.decisions.selectedHarnesses, ["opencode", "codex-app"]);
assert.equal(defaults.decisions.profileStrategy, "runtime-profiles");
assert.equal(defaults.decisions.memorySetup, "not-needed-for-coding-edition");
assert.equal(defaults.decisions.applyIntent, "preview-only");
assert.equal(defaults.decisions.apply, false);
assert.equal(defaults.providerCalls, 0);
assert.equal(defaults.provider_calls, 0);
assert.equal(defaults.traceEvent.data.provider_calls, 0);

const invalidHarness = recommend({ current: { harness: "unsupported" }, harnessStatus: { pi: "installed" } });
assert.deepEqual(invalidHarness.decisions.selectedHarnesses, ["pi"], "invalid harness values use the auto fallback");

const explicit = recommend({
  current: { edition: "full", harness: "codex", profile: "decide-later", memory: "postgres", name: "team", path: "/tmp/team" },
  harnessStatus: { opencode: "installed" }
});
assert.deepEqual(explicit.decisions.selectedHarnesses, ["codex-cli", "codex-app"]);
assert.equal(explicit.decisions.profileStrategy, "decide-later");
assert.equal(explicit.decisions.memorySetup, "postgres");
assert.equal(explicit.decisions.name, "team");
assert.equal(explicit.decisions.targetPath, "/tmp/team");

const memory = recommend({ current: { edition: "memory", harness: "none" } });
assert.equal(memory.decisions.profileStrategy, "not-needed-for-memory-edition");
assert.equal(memory.decisions.memorySetup, "decide-later");
assert.deepEqual(memory.decisions.selectedHarnesses, []);
assert.deepEqual(PHASES, ["Discover", "Choose", "Configure", "Review", "Apply"]);

let quick = createPathfinderState({ current: {}, harnessStatus: { opencode: "installed" } });
quick = transition(quick, { type: "USE_RECOMMENDED" });
assert.equal(quick.phase, "Review");
assert.equal(quick.decisions.apply, false);
quick = transition(quick, { type: "CONTINUE" });
assert.equal(quick.phase, "Apply");
quick = transition(quick, { type: "CONFIRM" });
assert.equal(quick.done, true);
assert.equal(quick.decisions.apply, false);

let custom = createPathfinderState();
custom = transition(custom, { type: "CUSTOMIZE" });
assert.equal(custom.phase, "Choose");
custom = transition(custom, { type: "NEXT" });
assert.equal(custom.phase, "Configure");
custom = transition(custom, { type: "PATCH", key: "name", value: "edited" });
custom = transition(custom, { type: "PATCH", key: "applyIntent", value: "apply-safe-steps" });
const backed = transition(custom, { type: "BACK" });
assert.equal(backed.phase, "Choose");
assert.equal(backed.decisions.name, "edited", "Back must preserve edits");
custom = transition(backed, { type: "NEXT" });
custom = transition(custom, { type: "NEXT" });
assert.equal(custom.phase, "Review");
assert.equal(transition(custom, { type: "CONFIRM" }).done, false, "Review cannot be bypassed");
custom = transition(custom, { type: "CONTINUE" });
custom = transition(custom, { type: "CONFIRM" });
assert.equal(custom.done, true);
assert.equal(custom.decisions.apply, true, "apply requires explicit confirmation after Review");

let overlayState = createPathfinderState();
for (const phase of PHASES) {
  overlayState = { ...overlayState, phase, done: false };
  const preview = transition(overlayState, { type: "OPEN_PREVIEW" });
  assert.equal(preview.overlay.type, "preview", `preview opens from ${phase}`);
  assert.equal(transition(preview, { type: "CLOSE_OVERLAY" }).overlay, null);
  const why = transition(overlayState, { type: "OPEN_WHY" });
  assert.equal(why.overlay.type, "why", `why opens from ${phase}`);
}

const narrow = render(createPathfinderState(), { columns: 80, rows: 24 });
assert.equal(narrow.text.split("\n").length, 24);
assert.ok(narrow.text.split("\n").every((line) => line.length <= 80));
assert.match(narrow.text, /Phase 1\/5: Discover/);
assert.match(narrow.text, /Preview:/);
assert.match(narrow.text, /p full Preview/);
assert.equal(narrow.provider_calls, 0);

let fullPreview = transition(createPathfinderState(), { type: "OPEN_PREVIEW" });
const firstPage = render(fullPreview, { columns: 80, rows: 24 });
assert.match(firstPage.text, /page 1\/3/);
fullPreview = transition(fullPreview, { type: "PAGE", delta: 1 });
assert.match(render(fullPreview, { columns: 80, rows: 24 }).text, /page 2\/3/);
for (let index = 0; index < 100; index += 1) fullPreview = transition(fullPreview, { type: "PAGE", delta: 1 });
assert.equal(fullPreview.overlay.page, 2, "preview page state is clamped at the final page");
for (let index = 0; index < 100; index += 1) fullPreview = transition(fullPreview, { type: "PAGE", delta: -1 });
assert.equal(fullPreview.overlay.page, 0, "preview page state is clamped at the first page");
let resizedPreview = transition(createPathfinderState(), { type: "OPEN_PREVIEW" });
resizedPreview = transition(resizedPreview, { type: "PAGE", delta: 100, pageSize: previewPageSize({ columns: 120, rows: 30 }) });
assert.equal(resizedPreview.overlay.page, 0, "wide viewport page bounds use the rendered page size");

const wide = render(createPathfinderState(), { columns: 120, rows: 30 });
assert.match(wide.text, /\[Discover\] > Choose > Configure > Review > Apply/);
assert.match(wide.text, /Why this recommendation/);
assert.ok(wide.text.split("\n").every((line) => line.length <= 120));

const model = previewModel(explicit.decisions);
assert.equal(model.providerCalls, 0);
assert.match(model.lines.join("\n"), /per-agent primary overrides plus one global fallback chain/);
assert.doesNotMatch(model.lines.join("\n"), /gpt-|claude-|gemini-/i);

const assignments = serializeAssignments({ ...explicit.decisions, apply: false });
for (const name of ["EDITION", "HARNESS", "PROFILE_STRATEGY", "MEMORY_SETUP", "NAME", "APPLY", "SKIP_PROFILE_MANAGER", "TUI_USED", "TUI_MODE", "TARGET_PATH"]) {
  assert.match(assignments, new RegExp(`^${name}=`, "m"));
}
assert.match(assignments, /^TUI_MODE='app'$/m);

const primaryPress = decodeTerminalEvent("\x1b[<0;12;8M");
assert.deepEqual(sgrMouseAction(primaryPress), { type: "activate", x: 12, y: 8 });
for (const sequence of ["\x1b[<0;12;8m", "\x1b[<1;12;8M", "\x1b[<2;12;8M", "\x1b[<4;12;8M", "\x1b[<8;12;8M", "\x1b[<16;12;8M", "\x1b[<32;12;8M"]) {
  assert.deepEqual(sgrMouseAction(decodeTerminalEvent(sequence), { overlayOpen: true }), { type: "ignore" }, `${JSON.stringify(sequence)} cannot activate`);
}
assert.deepEqual(sgrMouseAction(decodeTerminalEvent("\x1b[<64;12;8M"), { overlayOpen: true }), { type: "page", delta: -1 });
assert.deepEqual(sgrMouseAction(decodeTerminalEvent("\x1b[<65;12;8M"), { overlayOpen: true }), { type: "page", delta: 1 });
assert.deepEqual(sgrMouseAction(decodeTerminalEvent("\x1b[<64;12;8M")), { type: "ignore" });

for (const char of ["p", "w", "r", "b", "q"]) {
  const decoded = decodeTerminalEvent(char);
  assert.equal(decoded.type, "text");
  assert.deepEqual(printableInputAction(decoded.text, { textFieldFocused: true }), { type: "input", text: char });
}
assert.deepEqual(printableInputAction("p", { textFieldFocused: false }), { type: "token", token: "p" });
assert.deepEqual(printableInputAction("q", { textFieldFocused: false }), { type: "token", token: "cancel" });
assert.equal(decodeTerminalEvent("\x1b[200~").type, "ignore", "complete unsupported CSI is ignored");
assert.equal(decodeTerminalEvent("\x1b[20").type, "incomplete", "fragmented CSI waits for completion");
assert.equal(decodeTerminalEvent("\x1b[20" + "0~").type, "ignore", "completed CSI fragments are ignored as one sequence");
assert.equal(decodeTerminalEvent("\x1b]0;title\u0007").type, "ignore", "complete OSC is ignored");

console.log("install pathfinder tests ok");
