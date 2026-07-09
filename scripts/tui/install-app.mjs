#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import process from "node:process";

const editions = [
  { value: "coding", label: "Coding", help: "Agents, skills, runtime profiles, adapters, evals. No Memory DB." },
  { value: "memory", label: "Memory", help: "Memory API/MCP/OpenAPI, console, external AI adapters." },
  { value: "full", label: "Full", help: "Complete operations suite: coding + Memory." }
];
const harnesses = [
  { value: "opencode", label: "opencode", help: "Generate opencode preview artifacts." },
  { value: "codex-cli", label: "Codex CLI", help: "Generate previews for Codex CLI custom agents." },
  { value: "codex-app", label: "Codex App", help: "Generate previews for the Codex desktop/app surface." },
  { value: "pi", label: "Pi", help: "Target Pi previews; no live config writes." }
];
const memorySetups = [
  { value: "decide-later", label: "Decide later", help: "Recommended first run; no storage choice yet." },
  { value: "local-sqlite", label: "Local SQLite", help: "One-machine local coding-agent memory." },
  { value: "postgres", label: "Postgres", help: "Shared human/web/external AI memory." }
];

const state = {
  edition: envChoice("ALFRED_INSTALL_CURRENT_EDITION", editions, "coding"),
  selectedHarnesses: initialHarnesses(),
  harnessFocus: 0,
  harnessStatus: parseHarnessStatus(),
  useProfiles: process.env.ALFRED_INSTALL_CURRENT_PROFILE !== "decide-later",
  memorySetup: envChoice("ALFRED_INSTALL_CURRENT_MEMORY", memorySetups, "decide-later"),
  name: process.env.ALFRED_INSTALL_CURRENT_NAME || "acme",
  targetPath: process.env.ALFRED_INSTALL_CURRENT_PATH || "",
  apply: process.env.ALFRED_INSTALL_CURRENT_APPLY === "true",
  focus: 0,
  done: false,
  cancelled: false,
  message: "Use ↑/↓ to move, ←/→ to change, Space to toggle, Enter to review/apply. Mouse clicks work when supported."
};

function parseHarnessStatus() {
  const raw = process.env.ALFRED_INSTALL_HARNESS_STATUS || "";
  const map = new Map();
  for (const entry of raw.split(",")) {
    const [key, value] = entry.split("=");
    if (key && value) map.set(key, value);
  }
  return map;
}

function initialHarnesses() {
  const raw = process.env.ALFRED_INSTALL_CURRENT_HARNESS || "auto";
  if (raw === "auto") {
    const status = parseHarnessStatus();
    const installed = harnesses.filter((harness) => status.get(harness.value) === "installed").map((harness) => harness.value);
    return installed.length ? installed : [];
  }
  return parseHarnessList(raw);
}

function parseHarnessList(raw) {
  const selected = [];
  const add = (value) => {
    if (harnesses.some((harness) => harness.value === value) && !selected.includes(value)) selected.push(value);
  };
  for (const value of String(raw).split(/[,+| ]+/).filter(Boolean)) {
    if (value === "auto") {
      for (const harness of initialHarnesses()) add(harness);
    } else if (value === "codex") {
      add("codex-cli");
      add("codex-app");
    } else if (value !== "none") {
      add(value);
    }
  }
  return selected;
}

function envChoice(name, options, fallback) {
  const value = process.env[name];
  return options.some((option) => option.value === value) ? value : fallback;
}

function requiresMemory() {
  return state.edition === "memory" || state.edition === "full";
}

function rows() {
  const result = ["edition", "harness"];
  if (state.edition === "coding" || state.edition === "full") result.push("profiles");
  if (requiresMemory()) result.push("memory");
  result.push("name", "targetPath", "apply", "submit");
  return result;
}

function currentRow() {
  const list = rows();
  if (state.focus >= list.length) state.focus = list.length - 1;
  if (state.focus < 0) state.focus = 0;
  return list[state.focus];
}

function optionIndex(options, value) {
  return Math.max(0, options.findIndex((option) => option.value === value));
}

function cycle(options, value, delta) {
  const index = optionIndex(options, value);
  return options[(index + delta + options.length) % options.length].value;
}

function selectedOption(options, value) {
  return options.find((option) => option.value === value) || options[0];
}

function renderRadio(title, options, value, focused) {
  const rendered = options.map((option) => `${option.value === value ? "◉" : "○"} ${option.label}`).join("   ");
  const help = selectedOption(options, value).help;
  return `${focused ? "▶" : " "} ${title}\n   ${rendered}\n   ${dim(help)}`;
}

function renderCheckbox(title, checked, help, focused) {
  return `${focused ? "▶" : " "} ${title}\n   ${checked ? "☑" : "☐"} ${checked ? "Enabled" : "Disabled"}\n   ${dim(help)}`;
}

function renderHarnessMulti(focused) {
  const lines = [`${focused ? "▶" : " "} Harness targets`];
  lines.push("   Select one or more. Auto preselects installed harnesses.");
  for (const [index, harness] of harnesses.entries()) {
    const selected = state.selectedHarnesses.includes(harness.value);
    const status = state.harnessStatus.get(harness.value) || "not-installed";
    const cursor = focused && index === state.harnessFocus ? "›" : " ";
    lines.push(`   ${cursor} ${selected ? "☑" : "☐"} ${harness.label} [${status}]`);
  }
  const active = harnesses[state.harnessFocus] || harnesses[0];
  lines.push(`   ${dim(active.help)}`);
  return lines.join("\n");
}

function renderInput(title, value, placeholder, focused) {
  const content = value || dim(placeholder);
  return `${focused ? "▶" : " "} ${title}\n   [ ${content}${focused ? "_" : ""} ]`;
}

function dim(value) {
  return `\x1b[2m${value}\x1b[0m`;
}

function bold(value) {
  return `\x1b[1m${value}\x1b[0m`;
}

function screen() {
  const list = rows();
  const blocks = [];
  blocks.push(`${bold("Alfred installer")}  ${dim("app TUI • preview-first • provider calls: 0")}`);
  blocks.push(dim("Keyboard: ↑/↓ move · ←/→ choose · Space toggle · type in fields · Enter continue · q cancel"));
  blocks.push(dim("Mouse: click a section to focus/toggle where your terminal supports SGR mouse events"));
  blocks.push("");
  for (const [index, row] of list.entries()) {
    const focused = index === state.focus;
    if (row === "edition") blocks.push(renderRadio("Edition", editions, state.edition, focused));
    if (row === "harness") blocks.push(renderHarnessMulti(focused));
    if (row === "profiles") blocks.push(renderCheckbox("Runtime profiles", state.useProfiles, "Use shared defaults plus machine-local overlays for PATH/provider/model/plugin drift.", focused));
    if (row === "memory") blocks.push(renderRadio("Memory setup", memorySetups, state.memorySetup, focused));
    if (row === "name") blocks.push(renderInput("Install name", state.name, "acme", focused));
    if (row === "targetPath") blocks.push(renderInput("Target path (optional)", state.targetPath, "~/.alfred/installs/<name>", focused));
    if (row === "apply") blocks.push(renderCheckbox("Apply safe suite steps now", state.apply, "Off = preview only. On = clone/reuse Alfred and generate previews; live harness config still requires approval.", focused));
    if (row === "submit") blocks.push(`${focused ? "▶" : " "} ${bold("Review plan and continue")}\n   ${dim("Enter confirms these choices and returns to the installer plan.")}`);
    blocks.push("");
  }
  blocks.push(reviewLine());
  blocks.push(dim(state.message));
  return blocks.join("\n");
}

function reviewLine() {
  const profile = state.edition === "memory" ? "not-needed-for-memory-edition" : state.useProfiles ? "runtime-profiles" : "decide-later";
  const memory = requiresMemory() ? state.memorySetup : "not-needed-for-coding-edition";
  const path = state.targetPath || `~/.alfred/installs/${state.name || "acme"}`;
  const selected = state.selectedHarnesses.length ? state.selectedHarnesses.join(",") : "none";
  return `${bold("Review:")} edition=${state.edition} · harnesses=${selected} · profiles=${profile} · memory=${memory} · name=${state.name || "acme"} · path=${path} · apply=${state.apply ? "yes" : "no"}`;
}

function move(delta) {
  const list = rows();
  state.focus = (state.focus + delta + list.length) % list.length;
}

function change(delta) {
  const row = currentRow();
  if (row === "edition") state.edition = cycle(editions, state.edition, delta);
  if (row === "harness") state.harnessFocus = (state.harnessFocus + delta + harnesses.length) % harnesses.length;
  if (row === "memory") state.memorySetup = cycle(memorySetups, state.memorySetup, delta);
}

function toggleOrSubmit() {
  const row = currentRow();
  if (row === "profiles") state.useProfiles = !state.useProfiles;
  else if (row === "harness") toggleHarness();
  else if (row === "apply") state.apply = !state.apply;
  else if (row === "submit") state.done = true;
}

function toggleHarness() {
  const harness = harnesses[state.harnessFocus];
  if (!harness) return;
  if (state.selectedHarnesses.includes(harness.value)) {
    state.selectedHarnesses = state.selectedHarnesses.filter((value) => value !== harness.value);
  } else {
    state.selectedHarnesses = [...state.selectedHarnesses, harness.value];
  }
}

function inputText(text) {
  const row = currentRow();
  if (row !== "name" && row !== "targetPath") return;
  const clean = text.replace(/[\r\n]/g, "");
  if (row === "name") state.name += clean;
  if (row === "targetPath") state.targetPath += clean;
}

function backspace() {
  const row = currentRow();
  if (row === "name") state.name = state.name.slice(0, -1);
  if (row === "targetPath") state.targetPath = state.targetPath.slice(0, -1);
}

function handleToken(token) {
  if (!token) return;
  if (token === "up") move(-1);
  else if (token === "down") move(1);
  else if (token === "left") change(-1);
  else if (token === "right") change(1);
  else if (token === "space") toggleOrSubmit();
  else if (token === "enter") {
    if (currentRow() === "submit") state.done = true;
    else toggleOrSubmit();
  } else if (token === "backspace") backspace();
  else if (token.startsWith("text:")) inputText(token.slice(5));
  else if (token.startsWith("set:")) setValue(token.slice(4));
  else if (token.startsWith("mouse:")) handleMouseToken(token.slice(6));
  else if (token === "submit") state.done = true;
}

function setValue(pair) {
  const index = pair.indexOf("=");
  if (index < 0) return;
  const key = pair.slice(0, index);
  const value = pair.slice(index + 1);
  if (key === "edition" && editions.some((option) => option.value === value)) state.edition = value;
  if (key === "harness" || key === "harnesses") state.selectedHarnesses = parseHarnessList(value);
  if (key === "profiles") state.useProfiles = value !== "decide-later" && value !== "false";
  if (key === "memory" && memorySetups.some((option) => option.value === value)) state.memorySetup = value;
  if (key === "name") state.name = value;
  if (key === "path") state.targetPath = value;
  if (key === "apply") state.apply = value === "true" || value === "yes";
}

function handleMouseToken(token) {
  const [, yText] = token.split(":");
  const y = Number(yText);
  const list = rows();
  if (Number.isFinite(y)) state.focus = Math.max(0, Math.min(list.length - 1, Math.floor((y - 5) / 4)));
  toggleOrSubmit();
}

function parseBytes(data) {
  const text = data.toString("utf8");
  let index = 0;
  while (index < text.length) {
    const rest = text.slice(index);
    const mouse = /^\x1b\[<(\d+);(\d+);(\d+)([mM])/.exec(rest);
    if (mouse) {
      handleMouseToken(`${mouse[2]}:${mouse[3]}`);
      index += mouse[0].length;
      continue;
    }
    if (rest.startsWith("\x1b[A")) {
      handleToken("up");
      index += 3;
      continue;
    }
    if (rest.startsWith("\x1b[B")) {
      handleToken("down");
      index += 3;
      continue;
    }
    if (rest.startsWith("\x1b[D")) {
      handleToken("left");
      index += 3;
      continue;
    }
    if (rest.startsWith("\x1b[C")) {
      handleToken("right");
      index += 3;
      continue;
    }
    const char = text[index];
    if (char === "\u0003" || (char === "q" && currentRow() !== "name" && currentRow() !== "targetPath")) {
      state.cancelled = true;
      state.done = true;
      return;
    }
    if (char === "\r" || char === "\n") handleToken("enter");
    else if (char === " ") handleToken("space");
    else if (char === "\u007f") handleToken("backspace");
    else if (char === "\x1b") index = skipEscape(text, index) - 1;
    else inputText(char);
    index += 1;
  }
}

function skipEscape(text, start) {
  let index = start + 1;
  while (index < text.length && !/[A-Za-z~]/.test(text[index])) index += 1;
  return Math.min(index + 1, text.length);
}

function shellQuote(value) {
  return String(value).replace(/\n/g, "").replace(/'/g, "'\\''");
}

function assignments() {
  const profile = state.edition === "memory" ? "not-needed-for-memory-edition" : state.useProfiles ? "runtime-profiles" : "decide-later";
  const memory = requiresMemory() ? state.memorySetup : "not-needed-for-coding-edition";
  const name = state.name.trim() || "acme";
  const harnessSelection = state.selectedHarnesses.length ? state.selectedHarnesses.join(",") : "none";
  const lines = [
    `EDITION='${shellQuote(state.edition)}'`,
    `HARNESS='${shellQuote(harnessSelection)}'`,
    `PROFILE_STRATEGY='${shellQuote(profile)}'`,
    `MEMORY_SETUP='${shellQuote(memory)}'`,
    `NAME='${shellQuote(name)}'`,
    `APPLY='${state.apply ? "true" : "false"}'`,
    `SKIP_PROFILE_MANAGER='${profile === "decide-later" ? "true" : "false"}'`,
    `TUI_USED='true'`,
    `TUI_MODE='app'`
  ];
  if (state.targetPath.trim()) lines.push(`TARGET_PATH='${shellQuote(state.targetPath.trim())}'`);
  return `${lines.join("\n")}\n`;
}

function writeAssignments() {
  const output = assignments();
  const resultFile = process.env.ALFRED_INSTALL_APP_TUI_RESULT_FILE;
  if (resultFile) {
    writeFileSync(resultFile, output);
  } else {
    process.stdout.write(output);
  }
}

function runPlayback() {
  const script = process.env.ALFRED_INSTALL_APP_TUI_EVENTS || process.env.ALFRED_INSTALL_APP_TUI_SCRIPT || "";
  for (const token of script.split(/[,\n]+/).map((item) => item.trim()).filter(Boolean)) handleToken(token);
  if (process.env.ALFRED_INSTALL_APP_TUI_RENDER === "1") process.stderr.write(`${screen()}\n`);
  writeAssignments();
}

async function runInteractive() {
  const stdin = process.stdin;
  const stdout = process.stdout;
  const tty = stdin.isTTY && stdout.isTTY;
  if (!tty) {
    process.stderr.write("App TUI requires a TTY. Falling back to text installer.\n");
    process.exit(2);
  }
  stdin.setRawMode(true);
  stdin.resume();
  stdout.write("\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h");
  const redraw = () => stdout.write(`\x1b[H\x1b[2J${screen()}`);
  redraw();
  await new Promise((resolve) => {
    stdin.on("data", (data) => {
      parseBytes(data);
      if (state.done) resolve();
      else redraw();
    });
  });
  stdout.write("\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l");
  stdin.setRawMode(false);
  stdin.pause();
  if (state.cancelled) process.exit(130);
  writeAssignments();
}

if (process.env.ALFRED_INSTALL_APP_TUI_EVENTS || process.env.ALFRED_INSTALL_APP_TUI_SCRIPT) {
  runPlayback();
} else {
  runInteractive();
}
