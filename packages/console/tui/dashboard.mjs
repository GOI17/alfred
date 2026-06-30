#!/usr/bin/env node
// Alfred dashboard (TUI). Lightweight blessed-style terminal interface
// showing tenants, API keys, and live memory statistics.
//
// Built without external deps: ANSI escapes + raw-mode TTY. The TUI uses
// readline + cursor positioning to render a multi-pane view that updates
// on a tick.
//
// USAGE
//   alfred dashboard
//   alfred dashboard --refresh=5s
//   alfred dashboard --json      (dumps one snapshot and exits)
//
// KEYBINDINGS
//   q / Ctrl+C   quit
//   r           refresh now
//   n           issue new API key for selected tenant
//   d           detail view of selected tenant (memory counts, last access)
//   1-9         jump to tenant #N
//   Tab         next tenant
//   Shift+Tab   previous tenant

import { createInterface } from "node:readline";
import { openRegistry, defaultRegistryPath } from "../../memory-server/src/registry/store-factory.js";
import {
  createUserService
} from "../../memory/src/index.js";
import { createSqliteMemoryStore, openSqliteMemoryStore } from "../../memory/src/sqlite-memory-store.js";
import { createMemoryService } from "../../memory/src/index.js";

const REFRESH = 5000;
const ESC = "\x1b[";
const CLEAR = ESC + "2J";
const HOME = ESC + "H";
const HIDE_CURSOR = ESC + "?25l";
const SHOW_CURSOR = ESC + "?25h";
const RESET = ESC + "0m";
const BOLD = ESC + "1m";
const DIM = ESC + "2m";
const CYAN = ESC + "36m";
const YELLOW = ESC + "33m";
const GREEN = ESC + "32m";
const RED = ESC + "31m";
const MAGENTA = ESC + "35m";
const BLUE = ESC + "34m";

function clearScreen() {
  process.stdout.write(CLEAR + HOME);
}
function moveTo(row, col) {
  process.stdout.write(ESC + (row + 1) + ";" + (col + 1) + "H");
}
function writeAt(row, col, text) {
  moveTo(row, col);
  process.stdout.write(text + RESET);
}
function strip(s) {
  // Remove ANSI sequences for measuring width.
  return String(s).replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}
function pad(s, n) {
  const len = strip(s).length;
  if (len >= n) return s;
  return s + " ".repeat(n - len);
}
function shortId(id, n = 12) {
  return id.length > n ? id.slice(0, n) + "..." : id;
}

async function fetchSnapshot(refreshMs) {
  const registry = await openRegistry();
  try {
    const tenants = await registry.tenants.listTenants({ limit: 100, offset: 0 });
    const allKeys = [];
    for (const t of tenants.items) {
      const list = await registry.users.listApiKeys({ tenant_id: t.id, active_only: true });
      for (const k of list) allKeys.push({ ...k, tenant_id: t.id });
    }
    return {
      registry: registry.dbPath,
      tenants: tenants.items,
      keys: allKeys
    };
  } finally {
    registry.close();
  }
}

function render(snap, selectedIdx) {
  clearScreen();
  const w = process.stdout.columns || 100;
  const h = process.stdout.rows || 30;

  // Header
  writeAt(0, 0, BOLD + CYAN + "ALFRED MEMORY DASHBOARD" + RESET);
  writeAt(0, w - 30, DIM + "registry: " + shortId(snap.registry, 24) + RESET);

  // Section 1: Tenants
  writeAt(2, 0, BOLD + "TENANTS" + RESET);
  writeAt(2, 14, DIM + "(" + snap.tenants.length + ")" + RESET);
  const startRow = 4;
  snap.tenants.forEach((t, i) => {
    const row = startRow + i;
    if (row >= h - 8) return;
    const isSel = i === selectedIdx;
    const marker = isSel ? "▶ " : "  ";
    const kindColor =
      t.kind === "human_agent" ? MAGENTA :
      t.kind === "hybrid_with_human" ? YELLOW :
      t.kind === "server_managed" ? BLUE : GREEN;
    const line = marker + pad(t.id, 38) +
                kindColor + pad(t.kind, 22) + RESET +
                pad(t.storage_backend, 10) +
                DIM + "  " + (t.db_path || t.db_connection || "") + RESET;
    writeAt(row, 0, isSel ? BOLD + line : line);
  });

  // Section 2: Selected tenant keys
  const keyStart = startRow + snap.tenants.length + 2;
  if (snap.tenants.length > 0 && selectedIdx < snap.tenants.length) {
    const sel = snap.tenants[selectedIdx];
    writeAt(keyStart - 1, 0, BOLD + "API KEYS for " + sel.id + RESET);
    const ownKeys = snap.keys.filter((k) => k.tenant_id === sel.id);
    if (ownKeys.length === 0) {
      writeAt(keyStart, 0, DIM + "  (no active keys)" + RESET);
    }
    ownKeys.forEach((k, i) => {
      const row = keyStart + i;
      if (row >= h - 2) return;
      writeAt(row, 0, "  " + GREEN + pad(k.key_prefix + "....", 20) + RESET +
                      "label=" + (k.label || "—") +
                      "  created=" + (k.created_at?.slice(0, 10) || "—"));
    });
  }

  // Footer with keybindings
  const f = h - 1;
  writeAt(f, 0, DIM + "[q]quit [r]refresh [Tab]next [Shift+Tab]prev [n]new key [d]detail" + RESET);
}

async function detailView(snap, idx) {
  if (!snap.tenants[idx]) return;
  const t = snap.tenants[idx];
  clearScreen();
  writeAt(0, 0, BOLD + "DETAIL: " + t.id + RESET);
  writeAt(2, 0, "kind:        " + t.kind);
  writeAt(3, 0, "storage:     " + t.storage_backend);
  writeAt(4, 0, "db_path:     " + (t.db_path || "—"));
  writeAt(5, 0, "db_connection:" + (t.db_connection || "—"));
  writeAt(6, 0, "created:     " + t.created_at);
  writeAt(7, 0, "updated:     " + t.updated_at);
  if (t.storage_backend === "sqlite" && t.db_path) {
    try {
      const store = openSqliteMemoryStore(t.db_path);
      const svc = createMemoryService({ store });
      const list = await svc.listMemories(t.id, { limit: 1, offset: 0 });
      writeAt(9, 0, BOLD + "memory count: " + list.pagination.total + RESET);
      writeAt(10, 0, DIM + "  (press any key to go back)" + RESET);
      store.rawHandle?.close();
    } catch (err) {
      writeAt(9, 0, RED + "memory count: error - " + err.message + RESET);
      writeAt(10, 0, DIM + "  (press any key to go back)" + RESET);
    }
  } else {
    writeAt(9, 0, DIM + "(memory count unavailable for " + t.storage_backend + ")" + RESET);
    writeAt(10, 0, DIM + "  (press any key to go back)" + RESET);
  }
}

export async function runTui(argv = []) {
  const args = parseArgs(argv);
  if (args.json) {
    const snap = await fetchSnapshot();
    process.stdout.write(JSON.stringify(snap, null, 2) + "\n");
    return 0;
  }

  if (!process.stdin.isTTY) {
    process.stderr.write("alfred dashboard requires a TTY. Use --json for one-shot dump.\n");
    return 2;
  }

  process.stdout.write(HIDE_CURSOR);
  process.on("exit", () => process.stdout.write(SHOW_CURSOR));
  process.on("SIGINT", () => { process.stdout.write(SHOW_CURSOR); process.exit(0); });

  let selected = 0;
  let snap = await fetchSnapshot();
  render(snap, selected);

  const interval = setInterval(async () => {
    snap = await fetchSnapshot();
    if (selected >= snap.tenants.length) selected = Math.max(0, snap.tenants.length - 1);
    render(snap, selected);
  }, REFRESH);

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding(null);
  process.stdin.on("data", async (key) => {
    const s = key.toString();
    if (s === "q" || (key[0] === 3)) {
      clearInterval(interval);
      process.stdin.setRawMode(false);
      process.stdout.write(SHOW_CURSOR);
      process.exit(0);
    } else if (s === "r") {
      snap = await fetchSnapshot();
      render(snap, selected);
    } else if (s === "\t") {
      if (snap.tenants.length > 0) selected = (selected + 1) % snap.tenants.length;
      render(snap, selected);
    } else if (s === "d") {
      await detailView(snap, selected);
      process.stdin.once("data", () => render(snap, selected));
    } else if (s === "n") {
      if (snap.tenants.length === 0) return;
      const t = snap.tenants[selected];
      const userService = createUserService({ store: (await openRegistry()).users });
      try {
        const r = await userService.provisionApiKey({ tenant_id: t.id, label: "tui" });
        clearScreen();
        writeAt(0, 0, BOLD + GREEN + "New API key for " + t.id + RESET);
        writeAt(2, 0, "alk_key:    " + r.apiKey);
        writeAt(3, 0, "key_id:    " + r.key.id);
        writeAt(4, 0, "key_prefix:" + r.key.key_prefix);
        writeAt(5, 0, DIM + "(copy now; it won't be shown again)" + RESET);
        writeAt(7, 0, "press any key to return...");
        process.stdin.once("data", () => render(snap, selected));
      } catch (err) {
        process.stderr.write("Failed: " + err.message + "\n");
      }
    } else if (/^[1-9]$/.test(s)) {
      const n = parseInt(s, 10) - 1;
      if (n < snap.tenants.length) {
        selected = n;
        render(snap, selected);
      }
    } else if (key[0] === 27) {
      // ESC sequences (arrow keys start with 27). We only need basic up/down
      // for selection if many tenants.
      // (Optional: leave for a future iteration.)
    }
  });

  return new Promise(() => {}); // never resolves; TUI runs until exit
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      let k, v;
      const eq = a.indexOf("=");
      if (eq !== -1) { k = a.slice(2, eq); v = a.slice(eq + 1); }
      else { k = a.slice(2); v = argv[i + 1]; }
      if (v === undefined || v.startsWith("--")) { out[k] = true; } else { out[k] = v; i += 1; }
    } else { out._.push(a); }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTui(process.argv.slice(2)).catch((err) => {
    process.stdout.write(SHOW_CURSOR);
    process.stderr.write("alfred dashboard failed: " + err.message + "\n");
    process.exit(1);
  });
}
