import assert from "node:assert/strict";
import test from "node:test";
import { transition } from "../../../scripts/tui/install-pathfinder.mjs";
import {
  assignmentsForState,
  createInstallerState,
  frameForState,
  keyEventAction,
  lineTone,
  openTuiViewForState,
  responsiveLayout
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
    pageSize: 10
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
  assert.ok(result.lines.length <= 24);
  assert.match(result.lines.join("\n"), /ALFRED INSTALLER/);
  assert.match(result.lines.join("\n"), /PREVIEW MODE/);
  assert.match(result.lines.join("\n"), /Provider calls: 0|PROVIDERS 0/i);
  assert.ok(result.hitRegions.length > 0);
});

test("bounds and adapts the visual shell instead of stretching it", () => {
  assert.deepEqual(responsiveLayout({ columns: 80, rows: 24 }), {
    mode: "compact",
    columns: 80,
    rows: 24,
    width: 80,
    height: 24,
    headerHeight: 4,
    footerHeight: 4
  });
  assert.equal(responsiveLayout({ columns: 110, rows: 40 }).mode, "medium");
  assert.equal(responsiveLayout({ columns: 240, rows: 70 }).mode, "wide");
  assert.equal(responsiveLayout({ columns: 240, rows: 70 }).width, 148);
  assert.equal(responsiveLayout({ columns: 240, rows: 70 }).height, 34);
});

test("exposes navigation, decisions, and persistent preview in the wide view", () => {
  let state = createInstallerState({});
  state = transition(state, { type: "CUSTOMIZE" });
  const view = openTuiViewForState(state, { columns: 180, rows: 40 });
  assert.equal(view.layout.mode, "wide");
  assert.equal(view.steps.find(({ phase }) => phase === "Discover").status, "complete");
  assert.equal(view.steps.find(({ phase }) => phase === "Choose").status, "current");
  assert.match(view.main.rows.map(({ text }) => text).join("\n"), /\[suggested\]/);
  assert.match(view.preview.rows.map(({ text }) => text).join("\n"), /Preview-first/);
  assert.equal(view.provider_calls, 0);
});

test("marks user overrides separately from suggested values", () => {
  let state = createInstallerState({});
  state = transition(state, { type: "CUSTOMIZE" });
  state = transition(state, { type: "CHANGE", delta: 1 });
  const view = openTuiViewForState(state, { columns: 120, rows: 30 });
  assert.match(view.main.rows.map(({ text }) => text).join("\n"), /\[chosen\]/);
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
  assert.doesNotMatch(output, /^MODEL_/m);
});

test("omits model assignment from every OpenTUI setup phase", () => {
  const base = createInstallerState({});
  for (const phase of ["Discover", "Choose", "Configure", "Review", "Apply"]) {
    const state = { ...base, phase };
    const view = openTuiViewForState(state, { columns: 140, rows: 34 });
    const text = [
      ...view.main.rows.map(({ text: value }) => value),
      ...view.preview.rows.map(({ text: value }) => value),
      ...view.footer
    ].join("\n");
    assert.doesNotMatch(text, /model|models\.json/i, `${phase} must omit model assignment`);
  }
});

test("ignores injected legacy model overlays", () => {
  const base = createInstallerState({});
  for (const overlay of ["model-editor", "model-plan-review"]) {
    const state = {
      ...base,
      phase: "Configure",
      overlay: { type: overlay, page: 0 },
      editing: { kind: "model", control: "model:wildcard", draft: "provider/model", cursor: 0 },
      decisions: { ...base.decisions, modelStrategy: "custom-models", modelWriteApproved: true }
    };
    const view = openTuiViewForState(state, { columns: 140, rows: 34 });
    const text = [
      view.main.title,
      ...view.main.rows.map(({ text: value }) => value),
      ...view.preview.rows.map(({ text: value }) => value),
      ...view.footer
    ].join("\n");
    assert.equal(view.state.overlay, null);
    assert.equal(view.state.editing, null);
    assert.equal(view.state.decisions.modelStrategy, "configure-later");
    assert.equal(view.state.decisions.modelWriteApproved, false);
    assert.doesNotMatch(text, /model|models\.json|provider\/model/i);
  }
});
