import assert from "node:assert/strict";
import test from "node:test";
import { clearSessionMemoryKey, controlsFor, displayWidth, hasSessionMemoryKey, keyboardHintLines, previewModel, stepExplanationLines, transition } from "../../../scripts/tui/install-pathfinder.mjs";
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
    pageSize: 14
  });
});

test("preserves printable text only while editing", () => {
  let state = createInstallerState({});
  state = transition(state, { type: "CUSTOMIZE" });
  state = transition(state, { type: "NEXT" });
  state = transition(state, { type: "FOCUS_CONTROL", control: "path" });
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
    footerHeight: 9
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

test("keeps the final settings decision inside Review with explicit actions", () => {
  const review = transition(createInstallerState({}), { type: "USE_RECOMMENDED" });
  const view = openTuiViewForState(review, { columns: 120, rows: 30 });
  const text = view.main.rows.map(({ text }) => text).join("\n");
  assert.equal(view.state.phase, "Review");
  assert.match(text, /Accept & apply reviewed settings/);
  assert.match(text, /Keep preview only/);
  assert.match(text, /Edit settings \/ back/);
  assert.match(text, /Cancel setup/);

  const selected = transition(review, { type: "REVIEW_DECISION", intent: "apply-safe-steps" });
  assert.equal(selected.phase, "Apply");
  assert.equal(selected.done, false, "review selection does not bypass final confirmation");
  assert.equal(selected.decisions.apply, false);
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


test("? toggles contextual help in every step and responsive layout", () => {
  for (const phase of ["Discover", "Choose", "Configure", "Review", "Apply"]) {
    for (const columns of [60, 80, 110, 148]) {
      const viewport = { columns, rows: 24 };
      const state = { ...createInstallerState({}), phase, focus: 1 };
      const initial = frameForState(state, viewport);
      assert.doesNotMatch(initial.lines.join("\n"), /What this configuration changes/);
      assert.ok(initial.lines.includes("? Help"));
      const action = keyEventAction(key("?", "?", { shift: true }), state);
      assert.deepEqual(action, { type: "OPEN_WHY" });
      const opened = transition(state, action);
      const view = openTuiViewForState(opened, viewport);
      assert.equal(view.main.title, "What this configuration changes");
      assert.ok(view.main.rows.length > 0);
      assert.deepEqual(transition(opened, keyEventAction(key("?"), opened)), state);
      assert.deepEqual(transition(opened, keyEventAction(key("escape"), opened)), state);
      assert.equal(view.provider_calls, 0);
    }
  }
});

test("Discover keeps the recommended action and hides the shortcut label and Memory row", () => {
  const state = createInstallerState({});
  const view = openTuiViewForState(state);
  const text = view.main.rows.map(({ text }) => text).join("\n");
  assert.match(text, /Use recommended setup/);
  assert.doesNotMatch(text, /\[r\]|Memory connection/);
  assert.equal(transition(state, keyEventAction(key("r"), state)).phase, "Review");
  const help = openTuiViewForState(transition(state, keyEventAction(key("?"), state)));
  assert.match(help.main.rows.map(({ text }) => text).join(" "), /Use recommended setup.*Coding/);
});

test("Choose shows edition alternatives and pages through editions and profile use cases", () => {
  const choose = transition(createInstallerState({}), { type: "CUSTOMIZE" });
  const choice = openTuiViewForState(choose).main.rows.find(({ control }) => control === "edition");
  assert.match(choice.text, /← Coding →/);
  assert.equal(transition(choose, keyEventAction(key("right"), choose)).decisions.edition, "memory");
  assert.equal(transition(choose, keyEventAction(key("left"), choose)).decisions.edition, "full");

  for (const columns of [60, 80, 110, 148]) {
    const viewport = { columns, rows: 24 };
    let state = transition(choose, keyEventAction(key("?"), choose));
    let view = openTuiViewForState(state, viewport);
    state = view.state;
    const pageCount = Number(view.main.subtitle.match(/page 1\/(\d+)/)[1]);
    assert.ok(pageCount > 1, "compact help must allow reading all options");
    const pages = [];
    for (let page = 0; page < pageCount; page += 1) {
      if (page > 0) {
        state = transition(state, keyEventAction(key("right"), state, viewport));
        view = openTuiViewForState(state, viewport);
        state = view.state;
      }
      assert.equal(state.overlay.page, page);
      pages.push(view.main.rows.map(({ text }) => text).join(" "));
      assert.ok(frameForState(state, viewport).lines.slice(2).every((line) => displayWidth(line) <= columns));
      assert.ok(view.main.rows.every(({ text }) => !text.includes("…")), "help wraps without clipping words");
    }
    const text = pages.join(" ");
    for (const pattern of [/Coding —.*Use\s+for/, /Memory —.*Use\s+for/, /Full —.*Use\s+when/, /Runtime profiles:/, /  - Enabled —/, /  - Skipped \(Configure later\) —/]) assert.match(text, pattern);
    assert.doesNotMatch(text, /Install name —|Memory — Postgres|model assignment/);
    assert.equal(transition(state, keyEventAction(key("right"), state, viewport)).overlay.page, pageCount - 1);
    const dismissed = transition(state, keyEventAction(key("escape"), state));
    assert.equal(dismissed.focus, choose.focus);
    assert.deepEqual(dismissed.decisions, choose.decisions);
    const next = transition(dismissed, { type: "NEXT" });
    assert.equal(next.phase, "Configure");
    assert.equal(next.overlay, null);
    assert.doesNotMatch(frameForState(next, viewport).lines.join("\n"), /What this configuration changes/);
  }
});

test("? is text while editing and w remains a help alias", () => {
  let state = transition(createInstallerState({}), { type: "CUSTOMIZE" });
  assert.deepEqual(keyEventAction(key("w"), state), { type: "OPEN_WHY" });
  state = transition(state, { type: "NEXT" });
  state = transition(state, { type: "FOCUS_CONTROL", control: "path" });
  state = transition(state, { type: "ACTIVATE" });
  assert.deepEqual(keyEventAction(key("?"), state), { type: "INPUT", text: "?" });
});


test("24-column help preserves every character across rendered pages", () => {
  const viewport = { columns: 24, rows: 24 };
  const choose = transition(createInstallerState({}), { type: "CUSTOMIZE" });
  let state = transition(choose, keyEventAction(key("?"), choose));
  let view = openTuiViewForState(state, viewport);
  state = view.state;
  const pageCount = Number(view.main.subtitle.match(/page 1\/(\d+)/)[1]);
  const renderedRows = [];
  for (let page = 0; page < pageCount; page += 1) {
    if (page > 0) {
      state = transition(state, keyEventAction(key("right"), state, viewport));
      view = openTuiViewForState(state, viewport);
      state = view.state;
    }
    assert.equal(state.overlay.page, page);
    const frame = frameForState(state, viewport);
    const contentRows = frame.lines.filter((line) => line.startsWith("│")).slice(1);
    for (const { text } of view.main.rows) {
      assert.ok(displayWidth(text) <= 16, "help fits after the native panel padding and pointer");
      assert.ok(contentRows.some((line) => line.startsWith(`│  ${text}`)), `rendered help preserves: ${text}`);
    }
    renderedRows.push(...contentRows.map((line) => line.slice(3, -1).trimEnd()));
  }
  const normalized = (text) => text.replace(/\s/g, "");
  assert.equal(normalized(renderedRows.join("")), normalized(stepExplanationLines(choose).slice(1).join("")));
});


test("vertical keyboard hints immediately follow the container and preserve focused controls", () => {
  for (const phase of ["Discover", "Choose", "Configure", "Review", "Apply"]) {
    for (const viewport of [{ columns: 80, rows: 24 }, { columns: 148, rows: 50 }]) {
      const base = { ...createInstallerState({}), phase };
      for (const control of controlsFor(base)) {
        const state = transition(base, { type: "FOCUS_CONTROL", control });
        const view = openTuiViewForState(state, viewport);
        const frame = frameForState(state, viewport);
        const keysIndex = frame.lines.indexOf("Keys:");
        assert.match(frame.lines[keysIndex - 1], /└─+┘$/, "keys directly follow the container border");
        assert.deepEqual(frame.lines.slice(keysIndex), keyboardHintLines(state));
        assert.equal(view.layout.footerHeight, view.footer.length);
        assert.doesNotMatch(view.footer.join("\n"), /Phase|layout:|provider calls|Preview:|Safety/i);
        const focused = view.main.rows.find((entry) => entry.control === control);
        assert.ok(focused?.focused, `${phase} focuses ${control}`);
        assert.ok(frame.lines.some((line) => line.includes(`› ${focused.text.slice(0, 25)}`)), `${phase} ${control} stays visible at ${viewport.columns}x${viewport.rows}`);
      }
    }
  }
});

test("editing and overlay keyboard lists reserve their actual height", () => {
  let state = transition(createInstallerState({}), { type: "CUSTOMIZE" });
  state = transition(state, { type: "NEXT" });
  state = transition(state, { type: "FOCUS_CONTROL", control: "path" });
  const editing = transition(state, { type: "ACTIVATE" });
  for (const current of [editing, transition(state, { type: "OPEN_WHY" }), transition(state, { type: "OPEN_PREVIEW" })]) {
    const frame = frameForState(current);
    const keysIndex = frame.lines.indexOf("Keys:");
    assert.match(frame.lines[keysIndex - 1], /└─+┘$/);
    assert.deepEqual(frame.lines.slice(keysIndex), keyboardHintLines(current));
    assert.ok(frame.lines.length <= 24);
    if (current.editing) assert.ok(frame.lines.includes("Backspace Erase before"));
    else assert.ok(frame.lines.some((line) => /page 1\/\d+/.test(line)), "page counts stay inside the panel");
  }
});

test("wrapped preview pages remain complete above the vertical keyboard list", () => {
  const base = createInstallerState({});
  const normalized = (text) => text.replace(/\s/g, "");
  for (const columns of [24, 80]) {
    const viewport = { columns, rows: 24 };
    let state = transition(base, { type: "OPEN_PREVIEW" });
    let view = openTuiViewForState(state, viewport);
    state = view.state;
    const pageCount = Number(view.main.subtitle.match(/page 1\/(\d+)/)[1]);
    const renderedRows = [];
    for (let page = 0; page < pageCount; page += 1) {
      if (page > 0) state = transition(state, keyEventAction(key("right"), state, viewport));
      view = openTuiViewForState(state, viewport);
      state = view.state;
      const frame = frameForState(state, viewport);
      assert.ok(frame.lines.some((line) => line.includes(`page ${page + 1}/${pageCount}`)));
      renderedRows.push(...frame.lines.filter((line) => line.startsWith("│")).slice(1).map((line) => line.slice(3, -1).trimEnd()));
    }
    assert.equal(normalized(renderedRows.join("")), normalized(previewModel(base.decisions, base.discovery).lines.join("")));
  }
});


test("keyboard and direct focus changes refresh the option-specific keys and footer height", () => {
  let state = transition(createInstallerState({}), { type: "CUSTOMIZE" });
  const expected = [
    ["edition", ["←→ Change", "Space Change"]],
    ["harness:opencode", ["Space Toggle", "Enter Toggle"]],
    ["next", ["Enter Continue"]]
  ];
  for (const [control, actions] of expected) {
    state = transition(state, { type: "FOCUS_CONTROL", control });
    const view = openTuiViewForState(state);
    assert.deepEqual(view.footer.slice(2, -4), actions);
    assert.equal(view.layout.footerHeight, actions.length + 6);
    const frame = frameForState(state);
    assert.deepEqual(frame.lines.slice(frame.lines.indexOf("Keys:")), view.footer);
    assert.ok(frame.lines.length <= 24);
  }
  state = transition(state, keyEventAction(key("down"), state));
  assert.equal(controlsFor(state)[state.focus], "edition");
  assert.ok(openTuiViewForState(state).footer.includes("Space Change"));
  assert.ok(!openTuiViewForState(state).footer.some((line) => line.startsWith("Enter")));
  state = transition(state, { type: "NEXT" });
  state = transition(state, { type: "FOCUS_CONTROL", control: "path" });
  assert.ok(openTuiViewForState(state).footer.includes("Enter Edit path"));
  assert.doesNotMatch(openTuiViewForState(state).footer.join("\n"), /Change|Toggle/);
});


test("help groups options without telemetry and overlay keys only show pages and close", () => {
  const base = createInstallerState({});
  for (const phase of ["Discover", "Choose", "Configure", "Review", "Apply"]) {
    const state = { ...base, phase };
    for (const type of ["OPEN_WHY", "OPEN_PREVIEW"]) {
      let opened = transition(state, { type });
      const view = openTuiViewForState(opened);
      assert.deepEqual(view.footer, ["Keys:", "↑↓/←→ Pages", "Esc Close"]);
      if (type === "OPEN_WHY") {
        opened = view.state;
        const totalPages = Number(view.main.subtitle.match(/page 1\/(\d+)/)[1]);
        for (let page = 0; page < totalPages; page += 1) {
          const current = openTuiViewForState(opened);
          assert.doesNotMatch(current.main.rows.map(({ text }) => text).join(" "), /Provider calls:/i);
          opened = transition(current.state, keyEventAction(key("right"), current.state));
        }
      }
    }
  }
  const choose = transition(base, { type: "CUSTOMIZE" });
  const grouped = openTuiViewForState(transition(choose, { type: "OPEN_WHY" }), { columns: 80, rows: 50 });
  const text = grouped.main.rows.map(({ text }) => text).join("\n");
  assert.match(text, /^Editions:$/m);
  assert.match(text, /^  - Coding —/m);
  assert.match(text, /^Runtime profiles:$/m);
  assert.match(text, /^  - Enabled —/m);
  assert.match(text, /^    \S/m, "wrapped descriptions keep a hanging indent");
  assert.doesNotMatch(text, /Harnesses —|Continue —/);
});


test("Configure exposes one Path field and editing starts from its displayed value", () => {
  for (const environment of [{}, { ALFRED_INSTALL_CURRENT_NAME: "old-name", ALFRED_INSTALL_CURRENT_PATH: "/tmp/path-name///" }]) {
    let state = transition(createInstallerState(environment), { type: "CUSTOMIZE" });
    state = transition(state, { type: "NEXT" });
    const view = openTuiViewForState(state);
    assert.deepEqual(controlsFor(state), ["path", "intent", "next"]);
    assert.ok(!view.main.rows.some(({ control }) => control === "name"));
    const pathRow = view.main.rows.find(({ control }) => control === "path");
    const expectedPath = environment.ALFRED_INSTALL_CURRENT_PATH || "~/.alfred/installs/acme";
    assert.ok(pathRow.text.includes(`[ ${expectedPath} ]`));
    assert.ok(view.footer.includes("Enter Edit path"));
    const editing = transition(state, keyEventAction(key("return"), state));
    assert.equal(editing.editing.draft, expectedPath);
    const changed = transition(editing, { type: "INPUT", text: "new-folder" });
    assert.deepEqual(transition(changed, keyEventAction(key("escape"), changed)), state);
    const saved = transition(changed, keyEventAction(key("return"), changed));
    assert.equal(saved.decisions.name, environment.ALFRED_INSTALL_CURRENT_PATH ? "new-folder" : "acmenew-folder");
    assert.ok(frameForState(saved).lines.length <= 24);
    assert.ok(!openTuiViewForState(saved).main.rows.some(({ control }) => control === "name"));
    assert.ok(assignmentsForState(saved, {}).includes(`NAME='${saved.decisions.name}'`));
    assert.doesNotMatch(assignmentsForState(saved, {}), /^TARGET_PATH='~/m);
  }
});


test("existing Memory tenant exposes masked session-only key capture in both view and frame", () => {
  const syntheticKey = "alk_opentui_synthetic_key_DO_NOT_USE";
  let state = createInstallerState({ ALFRED_INSTALL_CURRENT_EDITION: "memory", ALFRED_INSTALL_CURRENT_MEMORY: "existing-tenant" });
  state = transition(transition(state, { type: "CUSTOMIZE" }), { type: "NEXT" });
  state = transition(state, { type: "FOCUS_CONTROL", control: "memory-key" });
  let view = openTuiViewForState(state);
  assert.ok(view.main.rows.some(({ control, text }) => control === "memory-key" && text.includes("not provided")));
  assert.ok(view.main.rows.some(({ text }) => text === "Session only. Not saved or connected."));
  assert.ok(view.footer.includes("Enter Edit API key"));
  state = transition(state, keyEventAction(key("return"), state));
  state = transition(state, keyEventAction(key("text", syntheticKey), state));
  for (const viewport of [{ columns: 80, rows: 24 }, { columns: 148, rows: 34 }]) {
    view = openTuiViewForState(state, viewport);
    assert.ok(view.main.rows.some(({ control, text }) => control === "memory-key" && text.includes("••••")));
    assert.ok(!JSON.stringify(view).includes(syntheticKey));
    assert.ok(!JSON.stringify(frameForState(state, viewport)).includes(syntheticKey));
    assert.ok(!assignmentsForState(state, {}).includes(syntheticKey));
  }
  state = transition(state, keyEventAction(key("return"), state));
  assert.equal(hasSessionMemoryKey(state), true);
  assert.ok(!JSON.stringify(openTuiViewForState(state)).includes(syntheticKey));
  const saved = state;
  state = transition(state, keyEventAction(key("return"), state));
  state = transition(state, keyEventAction(key("text", "alk_synthetic_replacement"), state));
  state = transition(state, keyEventAction(key("escape"), state));
  assert.deepEqual(state, saved);
  assert.equal(hasSessionMemoryKey(state), true);
  for (const control of controlsFor(state)) {
    const focused = transition(state, { type: "FOCUS_CONTROL", control });
    const focusedRow = openTuiViewForState(focused).main.rows.find((entry) => entry.control === control);
    assert.ok(frameForState(focused).lines.some((line) => line.includes(`› ${focusedRow.text.slice(0, 25)}`)), `${control} remains reachable at 80x24`);
  }
  state = transition(state, keyEventAction(key("c", "\u0003", { ctrl: true }), state));
  assert.equal(state.cancelled, true);
  assert.equal(hasSessionMemoryKey(saved), false);
  assert.ok(!JSON.stringify(state).includes(syntheticKey));
});

test("invalid keys stay masked and render only a generic local syntax error", () => {
  const invalidKey = "synthetic_invalid_key_DO_NOT_USE";
  let state = createInstallerState({ ALFRED_INSTALL_CURRENT_EDITION: "full", ALFRED_INSTALL_CURRENT_MEMORY: "existing-tenant" });
  state = transition(transition(state, { type: "CUSTOMIZE" }), { type: "NEXT" });
  state = transition(state, { type: "FOCUS_CONTROL", control: "memory-key" });
  state = transition(state, { type: "ACTIVATE" });
  state = transition(state, { type: "INPUT", text: invalidKey });
  state = transition(state, { type: "ACTIVATE" });
  const view = openTuiViewForState(state);
  assert.equal(hasSessionMemoryKey(state), false);
  assert.ok(view.main.rows.some(({ text }) => text.startsWith("Use alk_ followed by")));
  assert.ok(!JSON.stringify(view).includes(invalidKey));
  assert.ok(!JSON.stringify(frameForState(state)).includes(invalidKey));
  assert.deepEqual(view.footer, ["Keys:", "←→ Cursor", "Enter Save", "Esc Cancel edit", "Backspace Erase before", "Delete Erase after"]);
  clearSessionMemoryKey(state);
});
