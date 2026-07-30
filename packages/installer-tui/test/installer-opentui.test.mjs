import assert from "node:assert/strict";
import test from "node:test";
import { transition } from "../../../scripts/tui/install-pathfinder.mjs";
import {
  assignmentsForState,
  createInstallerState,
  frameForState,
  keyEventAction,
  lineTone
} from "../src/installer-opentui.mjs";

function key(name, sequence = name, extra = {}) {
  return { name, sequence, eventType: "press", ctrl: false, meta: false, option: false, ...extra };
}

test("maps structured OpenTUI keys to Pathfinder actions", () => {
  const state = createInstallerState({});
  assert.deepEqual(keyEventAction(key("r"), state), { type: "USE_RECOMMENDED" });
  assert.deepEqual(keyEventAction(key("down", "\u001b[B"), state), { type: "MOVE", delta: 1 });
  assert.deepEqual(keyEventAction(key("return", "\r"), state), { type: "ACTIVATE" });
  assert.deepEqual(keyEventAction(key("c", "\u0003", { ctrl: true }), state), { type: "CANCEL" });
  assert.deepEqual(keyEventAction(key("q"), state), { type: "CANCEL" });
  assert.equal(keyEventAction(key("x", "\u001b]52;unsafe\u0007"), state), null);
});

test("maps overlay arrows to deterministic paging", () => {
  const state = transition(createInstallerState({}), { type: "OPEN_PREVIEW" });
  assert.deepEqual(keyEventAction(key("right", "\u001b[C"), state, { columns: 80, rows: 24 }), {
    type: "PAGE",
    delta: 1,
    pageSize: 8
  });
});

test("preserves printable text only while editing", () => {
  let state = createInstallerState({});
  state = transition(state, { type: "CUSTOMIZE" });
  state = transition(state, { type: "NEXT" });
  state = transition(state, { type: "FOCUS_CONTROL", control: "name" });
  state = transition(state, { type: "ACTIVATE" });
  assert.deepEqual(keyEventAction(key("z"), state), { type: "INPUT", text: "z" });
});

test("uses accessible Kanagawa tones with non-color markers intact", () => {
  assert.equal(lineTone("Alfred installer", 0, 10), "blue");
  assert.equal(lineTone("> Full", 2, 10), "blue");
  assert.equal(lineTone("✓ OpenCode installed", 2, 10), "green");
  assert.equal(lineTone("Warning: changed", 2, 10), "yellow");
  assert.equal(lineTone("Blocker: unsupported Node", 2, 10), "red");
  assert.equal(lineTone("Keys: arrows", 9, 10), "muted");
});

test("renders the shared 80x24 Pathfinder frame without provider calls", () => {
  const result = frameForState(createInstallerState({}), { columns: 80, rows: 24 });
  assert.equal(result.provider_calls, 0);
  assert.ok(result.lines.length <= 23);
  assert.match(result.lines.join("\n"), /Alfred installer/);
  assert.ok(result.hitRegions.length > 0);
});

test("serializes the established app TUI contract", () => {
  const state = {
    ...createInstallerState({}),
    done: true,
    reviewVisited: true
  };
  const output = assignmentsForState(state, {});
  assert.match(output, /^EDITION='coding'$/m);
  assert.match(output, /^TUI_USED='true'$/m);
  assert.match(output, /^TUI_MODE='app'$/m);
  assert.match(output, /^MODEL_WRITE_APPROVED='false'$/m);
});
