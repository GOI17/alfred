#!/usr/bin/env node
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const installSh = resolve(root, "install.sh");
const appTui = resolve(root, "scripts/tui/install-app.mjs");
const pathfinder = resolve(root, "scripts/tui/install-pathfinder.mjs");
const pathfinderTest = resolve(root, "scripts/tui/install-pathfinder.test.mjs");
const discovery = resolve(root, "scripts/tui/install-discovery.mjs");
const discoveryTest = resolve(root, "scripts/tui/install-discovery.test.mjs");
const fixture = mkdtempSync(join(tmpdir(), "alfred-suite-install-"));
const home = join(fixture, "home");
const cwd = join(fixture, "workspace");
mkdirSync(home, { recursive: true });
mkdirSync(cwd, { recursive: true });

function run(args, options = {}) {
  return spawnSync("sh", [options.installSh ?? installSh, ...args], {
    cwd: options.cwd ?? cwd,
    env: {
      ...process.env,
      HOME: home,
      PATH: process.env.PATH ?? "",
      ...(options.env ?? {})
    },
    encoding: "utf8"
  });
}

function runInteractiveLifecycle(layout, mode) {
  const childScript = `
    import { Writable } from "node:stream";
    const { runInteractive } = await import(${JSON.stringify(pathToFileURL(appTui).href)});
    let raw = false;
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdin, "isRaw", { configurable: true, get: () => raw });
    process.stdin.setRawMode = (value) => { raw = Boolean(value); return process.stdin; };
    const terminal = new Writable({
      write(chunk, encoding, callback) {
        process.stdout.write(chunk, encoding);
        callback();
      }
    });
    terminal.isTTY = true;
    terminal.columns = 80;
    terminal.rows = 24;
    await runInteractive({ stdin: process.stdin, stdout: terminal });
  `;
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--input-type=module", "--eval", childScript], {
      cwd,
      env: { ...process.env, ALFRED_INSTALL_APP_TUI_LAYOUT: layout },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let started = false;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      rejectPromise(new Error(`interactive ${layout} ${mode} lifecycle timed out`));
    }, 4000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (started || !stdout.includes("Alfred installer")) return;
      started = true;
      if (mode === "normal") child.stdin.write("r\r\r");
      if (mode === "cancel") child.stdin.write("q");
      if (mode === "signal") setTimeout(() => child.kill("SIGTERM"), 20);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

function pythonPtyCommand() {
  for (const command of ["python3", "python"]) {
    const probe = spawnSync(command, ["-c", "import sys; assert sys.version_info[0] >= 3; import fcntl, os, pty, select, signal, struct, termios"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return command;
  }
  return null;
}

function runPythonPtyLifecycle(command, discoveryFile) {
  const pythonScript = String.raw`
import json
import os
import pty
import select
import signal
import subprocess
import fcntl
import re
import struct
import sys
import termios
import time

node, app, discovery = sys.argv[1], sys.argv[2], sys.argv[3]
enter = b"\x1b[?1049h"
restore = b"\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l"
mouse_enable = b"\x1b[?1000h\x1b[?1006h"

def assert_terminal_output_safe(output, layout, label):
    text = output.decode("utf8", "replace")
    if layout == "fullscreen":
        allowed = re.compile(r"\x1b(?:\[[0-9;]*m|\[H|\[2J|\[\?(?:1049|25|1000|1006)[hl])")
    else:
        allowed = re.compile(r"\x1b(?:\[[0-9;]*m|\[[1-9][0-9]*A|\[2K|\[\?25[hl])")
    remaining = allowed.sub("", text)
    assert "\x1b" not in remaining, label + " emitted a terminal escape outside its owned controls"
    assert not any(0x80 <= ord(char) <= 0x9f for char in remaining), label + " emitted a C1 terminal control"
    assert not any(ord(char) < 0x20 and char not in "\r\n" for char in remaining), label + " emitted a C0 cursor/control character"
    for payload in ("injected osc52", "injected title", "injected dcs", "injected c1 title"):
        assert payload not in text, label + " emitted an injected terminal-control payload"
    for attack in ("\x1b[>4;2m", "\x1b[?1m", "\x1b[<1m", "\x1b[=1m", "\x1b[38:5:36m", "\x1b[31 m", "\x1b[31$m", "\x1b[;31m", "\x1b[31;;1m", "\x1b[31;m", "\x9b31m"):
        assert attack not in text, label + " emitted an injected SGR lookalike"

def run_case(layout, mode, expected):
    pid, fd = pty.fork()
    if pid == 0:
        env = os.environ.copy()
        env["ALFRED_INSTALL_APP_TUI_LAYOUT"] = layout
        env["ALFRED_INSTALL_DISCOVERY_FILE"] = discovery
        os.execve(node, [node, app], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    output = bytearray()
    sent = False
    status = None
    deadline = time.monotonic() + 4.0
    while time.monotonic() < deadline:
        readable, _, _ = select.select([fd], [], [], 0.05)
        if readable:
            try:
                chunk = os.read(fd, 4096)
            except OSError:
                chunk = b""
            output.extend(chunk)
        if not sent and b"Alfred installer" in output:
            if mode == "normal":
                os.write(fd, b"r\r\r")
            elif mode == "cancel":
                os.write(fd, b"q")
            else:
                os.kill(pid, signal.SIGTERM)
            sent = True
        waited, candidate = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            status = candidate
            break
    if status is None:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        raise AssertionError(layout + " " + mode + " PTY lifecycle timed out")
    drain_deadline = time.monotonic() + 0.25
    while time.monotonic() < drain_deadline:
        readable, _, _ = select.select([fd], [], [], 0.02)
        if not readable:
            break
        try:
            chunk = os.read(fd, 4096)
        except OSError:
            break
        if not chunk:
            break
        output.extend(chunk)
    os.close(fd)
    code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status)
    assert sent, layout + " " + mode + " never rendered"
    assert code == expected, "%s %s exited %s, expected %s" % (layout, mode, code, expected)
    if layout == "fullscreen":
        assert enter in output, mode + " did not enter alternate-screen mode"
        assert restore in output, mode + " did not emit fullscreen terminal restoration"
        assert mouse_enable in output, mode + " did not enable mouse reporting"
    else:
        assert b"\x1b[?1049" not in output, mode + " inline emitted alternate-screen control"
        assert b"\x1b[?1000" not in output and b"\x1b[?1006" not in output, mode + " inline emitted mouse control"
        assert b"\x1b[2J" not in output, mode + " inline cleared the terminal"
        assert b"\x1b[2K" in output, mode + " inline did not erase owned rows during redraw/cleanup"
        assert b"A" in output, mode + " inline did not use cursor-up ownership movement"
    assert_terminal_output_safe(bytes(output), layout, layout + " " + mode)
    if mode == "normal":
        assert b"TUI_MODE='app'" in output, "normal PTY completion lost result assignments"

def set_size(fd, columns, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))

def read_available(fd, output):
    readable, _, _ = select.select([fd], [], [], 0.02)
    if not readable:
        return False
    try:
        chunk = os.read(fd, 65536)
    except OSError:
        return False
    if not chunk:
        return False
    output.extend(chunk)
    return True

def run_inline_resize_case(mode, expected):
    pid, fd = pty.fork()
    if pid == 0:
        env = os.environ.copy()
        env["ALFRED_INSTALL_APP_TUI_LAYOUT"] = "inline"
        env["ALFRED_INSTALL_DISCOVERY_FILE"] = discovery
        env["NO_COLOR"] = "1"
        os.execve(node, [node, app], env)
    set_size(fd, 120, 30)
    output = bytearray()
    deadline = time.monotonic() + 5.0
    while b"Alfred installer" not in output and time.monotonic() < deadline:
        read_available(fd, output)
    assert b"Alfred installer" in output, mode + " resize PTY never rendered wide frame"
    time.sleep(0.05)
    while read_available(fd, output):
        pass
    initial = bytes(output)
    assert "界界界".encode("utf8") in initial, mode + " resize PTY lost CJK discovery content"
    assert "👩‍💻".encode("utf8") in initial, mode + " resize PTY lost emoji ZWJ discovery content"
    assert "é".encode("utf8") in initial, mode + " resize PTY lost combining discovery content"
    initial_plain = re.sub(br"\x1b\[[0-?]*[ -/]*[@-~]", b"", initial).decode("utf8").replace("\r", "")
    initial_lines = initial_plain.split("\n")
    if initial_lines and initial_lines[-1] == "":
        initial_lines.pop()
    calculator = ${JSON.stringify(`
      import { readFileSync } from "node:fs";
      import { terminalPhysicalRows } from ${JSON.stringify(pathToFileURL(pathfinder).href)};
      const lines = JSON.parse(readFileSync(0, "utf8"));
      const text = lines.join("\\n");
      process.stdout.write(String(terminalPhysicalRows(text, 20)));
    `)}
    calculated = subprocess.run([node, "--input-type=module", "--eval", calculator], input=json.dumps(initial_lines), text=True, capture_output=True)
    assert calculated.returncode == 0, calculated.stderr
    expected_narrow_rows = int(calculated.stdout)

    narrow_start = len(output)
    set_size(fd, 20, 8)
    while b"Resize terminal" not in output[narrow_start:] and time.monotonic() < deadline:
        read_available(fd, output)
    assert b"Resize terminal" in output[narrow_start:], mode + " resize PTY did not render narrow recovery frame"
    time.sleep(0.05)
    while read_available(fd, output):
        pass
    narrow = bytes(output[narrow_start:])
    assert narrow.startswith((b"\r\x1b[%dA" % (expected_narrow_rows - 1))), mode + " narrowing did not move to true reflowed frame start"
    assert narrow.count(b"\x1b[2K") >= expected_narrow_rows, mode + " narrowing left stale reflowed physical rows"

    wide_start = len(output)
    set_size(fd, 120, 30)
    while b"Alfred installer" not in output[wide_start:] and time.monotonic() < deadline:
        read_available(fd, output)
    assert b"Alfred installer" in output[wide_start:], mode + " resize PTY did not recover after widening"
    time.sleep(0.05)
    while read_available(fd, output):
        pass
    widened = bytes(output[wide_start:])
    assert widened.startswith(b"\r\x1b[3A"), mode + " widening did not own exactly the four-row recovery frame"
    assert widened.count(b"\x1b[2K") >= 4, mode + " widening left stale recovery-frame rows"

    action_start = len(output)
    if mode == "cancel":
        os.write(fd, b"q")
    else:
        os.kill(pid, signal.SIGTERM)
    status = None
    while time.monotonic() < deadline:
        read_available(fd, output)
        waited, candidate = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            status = candidate
            break
    if status is None:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
        raise AssertionError(mode + " resize PTY lifecycle timed out")
    time.sleep(0.05)
    while read_available(fd, output):
        pass
    os.close(fd)
    code = os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status)
    cleanup = bytes(output[action_start:])
    assert code == expected, "%s resize PTY exited %s, expected %s" % (mode, code, expected)
    assert b"\x1b[2K" in cleanup and b"\x1b[?25h" in cleanup, mode + " resize PTY did not erase the final owned frame and restore cursor"
    assert b"\x1b[?1049" not in output, mode + " resize PTY emitted alternate-screen control"
    assert b"\x1b[?1000" not in output and b"\x1b[?1006" not in output, mode + " resize PTY emitted mouse control"
    assert b"\x1b[2J" not in output, mode + " resize PTY emitted whole-screen clear"
    assert_terminal_output_safe(bytes(output), "inline", "inline " + mode + " resize")

for layout in ("fullscreen", "inline"):
    run_case(layout, "normal", 0)
    run_case(layout, "cancel", 130)
    run_case(layout, "signal", 143)
run_inline_resize_case("cancel", 130)
run_inline_resize_case("signal", 143)
print("real PTY lifecycle tests ok (Python pty)")
`;
  const result = spawnSync(command, ["-c", pythonScript, process.execPath, appTui, discoveryFile], {
    cwd,
    env: { ...process.env },
    encoding: "utf8",
    timeout: 15000
  });
  assert.notEqual(result.error?.code, "ETIMEDOUT", "Python PTY lifecycle suite timed out");
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  process.stdout.write(result.stdout);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runScriptPtyCase(layout, mode, utilLinux, discoveryFile) {
  const wrapper = `${shellQuote(process.execPath)} ${shellQuote(appTui)} & child=$!; printf '__ALFRED_PID__:%s\\n' "$child"; wait "$child"; code=$?; printf '__ALFRED_EXIT__:%s\\n' "$code"; exit "$code"`;
  const args = utilLinux ? ["-qfec", wrapper, "/dev/null"] : ["-q", "/dev/null", "sh", "-c", wrapper];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("script", args, { cwd, env: { ...process.env, ALFRED_INSTALL_APP_TUI_LAYOUT: layout, ALFRED_INSTALL_DISCOVERY_FILE: discoveryFile }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let sent = false;
    let nodePid = null;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { if (nodePid) process.kill(nodePid, "SIGKILL"); } catch {}
      child.kill("SIGKILL");
      rejectPromise(new Error(`script PTY ${layout} ${mode} lifecycle timed out`));
    }, 5000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const pidMatch = /__ALFRED_PID__:(\d+)/.exec(stdout);
      if (pidMatch) nodePid = Number(pidMatch[1]);
      if (sent || !nodePid || !stdout.includes("Alfred installer")) return;
      sent = true;
      if (mode === "normal") child.stdin.write("r\r\r");
      if (mode === "cancel") child.stdin.write("q");
      if (mode === "signal") process.kill(nodePid, "SIGTERM");
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        const expected = mode === "normal" ? 0 : mode === "cancel" ? 130 : 143;
        const exitMatch = /__ALFRED_EXIT__:(\d+)/.exec(stdout);
        assert.equal(Number(exitMatch?.[1]), expected, `${mode} script PTY child exit mismatch\n${stdout}\n${stderr}`);
        if (layout === "fullscreen") {
          assert.match(stdout, /\x1b\[\?1049h/);
          assert.match(stdout, /\x1b\[\?1000h\x1b\[\?1006h/);
          assert.match(stdout, /\x1b\[\?1006l\x1b\[\?1000l\x1b\[\?25h\x1b\[\?1049l/, `${mode} script PTY did not restore terminal modes`);
        } else {
          assert.doesNotMatch(stdout, /\x1b\[\?1049|\x1b\[\?1000|\x1b\[\?1006|\x1b\[2J/, `${mode} inline script PTY emitted forbidden terminal controls`);
          assert.match(stdout, /\x1b\[2K/, `${mode} inline script PTY did not erase owned rows`);
        }
        assert.doesNotMatch(stdout, /\x1b\]|\x1b[PX^_]|\x1b\[(?:>4;2|\?1|<1|=1|38:5:36|31 |31\$|;31|31;;1|31;)m|[\u0090\u0098\u009b\u009d\u009e\u009f]|injected osc52|injected title|injected dcs|injected c1 title/, `${layout} ${mode} script PTY emitted injected terminal controls`);
        if (mode === "normal") assert.match(stdout, /TUI_MODE='app'/);
        resolvePromise();
      } catch (error) {
        rejectPromise(error);
      }
    });
  });
}

async function runRealPtyLifecycle() {
  const ptyDiscovery = join(fixture, "pty-unicode-discovery.json");
  const osc52 = "\x1b]52;c;injected osc52\x07";
  const oscTitle = "\x1b]0;injected title\x1b\\";
  const dcs = "\x1bP1;2|injected dcs\x1b\\";
  const c1Csi = "\x9b31m";
  const c1Osc = "\x9d0;injected c1 title\x9c";
  const sgrLookalikes = "\x1b[>4;2m\x1b[?1m\x1b[<1m\x1b[=1m\x1b[38:5:36m\x1b[31 m\x1b[31$m\x1b[;31m\x1b[31;;1m\x1b[31;m";
  writeFileSync(ptyDiscovery, JSON.stringify({
    schema: "alfred.install.discovery/v1",
    os: { platform: `te${oscTitle}st`, release: `界界界${"a界".repeat(28)}👩‍💻é${dcs}${sgrLookalikes}\tstable`, architecture: `arm${c1Csi}64` },
    node: { status: "ok", version: `v24.1.0${c1Osc}\r\nnext\b`, major: 24, required_major: 22 },
    harnesses: { opencode: "not-installed", "codex-cli": "not-installed", "codex-app": "not-installed", pi: "not-installed" },
    models: {
      suggestions: [{ provider: `ol${osc52}lama`, model: `ollama/qwen${dcs}\t2.5`, source: `socket:/tmp/model${oscTitle}.sock` }],
      proposed_config: { "*": { primary: `ollama/${c1Csi}qwen` }, fallbacks: [`fallback${osc52}/one`] },
      validation: { status: "fail", errors: [] }, existing_config: false
    },
    install: { alfred_home: "/tmp/.alfred", selected_target: `/tmp/界界界/${osc52}👩‍💻/é\nnext`, target_exists: false, models_config_path: `/tmp/.alfred/${dcs}models.json`, models_config_exists: false },
    git: { availability: "installed", workspace_root: `/tmp/界界界${c1Osc}\twork`, project_root: `/tmp/👩‍💻/${oscTitle}é\rroot`, repository_state: "repository", linked_worktree_state: "main-worktree" },
    provider_calls: 0
  }));
  const python = pythonPtyCommand();
  if (python) {
    runPythonPtyLifecycle(python, ptyDiscovery);
    return;
  }
  const scriptProbe = spawnSync("script", ["--version"], { encoding: "utf8" });
  if (!scriptProbe.error) {
    const utilLinux = `${scriptProbe.stdout}\n${scriptProbe.stderr}`.includes("util-linux");
    for (const layout of ["fullscreen", "inline"]) {
      await runScriptPtyCase(layout, "normal", utilLinux, ptyDiscovery);
      await runScriptPtyCase(layout, "cancel", utilLinux, ptyDiscovery);
      await runScriptPtyCase(layout, "signal", utilLinux, ptyDiscovery);
    }
    console.log("real PTY lifecycle tests ok (script)");
    return;
  }
  console.log("SKIP real PTY lifecycle tests: no Python pty module or script command is available");
}

try {
  const syntax = spawnSync("sh", ["-n", installSh], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  const appSyntax = spawnSync("node", ["--check", appTui], { encoding: "utf8" });
  assert.equal(appSyntax.status, 0, appSyntax.stderr);
  const pathfinderSyntax = spawnSync("node", ["--check", pathfinder], { encoding: "utf8" });
  assert.equal(pathfinderSyntax.status, 0, pathfinderSyntax.stderr);
  const discoverySyntax = spawnSync("node", ["--check", discovery], { encoding: "utf8" });
  assert.equal(discoverySyntax.status, 0, discoverySyntax.stderr);
  const discoveryTests = spawnSync("node", [discoveryTest], { encoding: "utf8" });
  assert.equal(discoveryTests.status, 0, discoveryTests.stderr);
  const pathfinderTests = spawnSync("node", [pathfinderTest], { encoding: "utf8" });
  assert.equal(pathfinderTests.status, 0, pathfinderTests.stderr);

  for (const layout of ["fullscreen", "inline"]) {
    const interactiveNormal = await runInteractiveLifecycle(layout, "normal");
    assert.equal(interactiveNormal.code, 0, interactiveNormal.stderr);
    assert.equal(interactiveNormal.signal, null);
    assert.match(interactiveNormal.stdout, /TUI_MODE='app'/);

    const interactiveCancel = await runInteractiveLifecycle(layout, "cancel");
    assert.equal(interactiveCancel.code, 130, interactiveCancel.stderr);
    assert.equal(interactiveCancel.signal, null);

    const interactiveSignal = await runInteractiveLifecycle(layout, "signal");
    assert.equal(interactiveSignal.code, 143, interactiveSignal.stderr);
    assert.equal(interactiveSignal.signal, null);

    for (const lifecycle of [interactiveNormal, interactiveCancel, interactiveSignal]) {
      if (layout === "fullscreen") {
        assert.match(lifecycle.stdout, /\x1b\[\?1049h/);
        assert.match(lifecycle.stdout, /\x1b\[\?1000h\x1b\[\?1006h/);
        assert.match(lifecycle.stdout, /\x1b\[\?1006l\x1b\[\?1000l\x1b\[\?25h\x1b\[\?1049l/, "fullscreen lifecycle restores terminal modes");
      } else {
        assert.doesNotMatch(lifecycle.stdout, /\x1b\[\?1049|\x1b\[\?1000|\x1b\[\?1006|\x1b\[2J/, "inline lifecycle avoids alternate screen, mouse reporting, and whole-screen clears");
        assert.match(lifecycle.stdout, /\x1b\[2K/, "inline lifecycle erases only owned rows");
        assert.match(lifecycle.stdout, /\x1b\[[1-9][0-9]*A/, "inline lifecycle uses cursor-up movement within owned rows");
        assert.match(lifecycle.stdout, /\x1b\[\?25h/, "inline lifecycle restores the cursor");
      }
    }
  }

  await runRealPtyLifecycle();

  const preview = run(["--edition=coding", "--name=acme"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /ALFRED SUITE INSTALL PREVIEW/);
  assert.match(preview.stdout, /Edition:\s+coding/);
  assert.match(preview.stdout, /Name:\s+acme/);
  assert.match(preview.stdout, /No files were written/);
  assert.match(preview.stdout, /Where files go and why:/);
  assert.match(preview.stdout, /Project you launched from:/);
  assert.match(preview.stdout, /Why outside the project by default:/);
  assert.match(preview.stdout, /Expected generated preview locations after apply:/);
  assert.match(preview.stdout, /Project modified: no\./);
  assert.doesNotMatch(preview.stdout, /Installing Alfred Pi Agent/);
  assert.match(preview.stdout, /TUI used:\s+false/);
  assert.match(preview.stdout, /TUI mode:\s+none/);
  assert.equal(existsSync(join(cwd, "AGENTS.md")), false, "preview must not create AGENTS.md");
  assert.equal(existsSync(join(cwd, ".alfred")), false, "preview must not create .alfred in cwd");

  const appTuiTemp = join(fixture, "app-tui-tmp");
  mkdirSync(appTuiTemp, { recursive: true });
  const appTuiPreview = run([], {
    env: {
      TMPDIR: appTuiTemp,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_LAYOUT: "inline",
      ALFRED_INSTALL_APP_TUI_RENDER: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS:
        "set:edition=full,set:harnesses=opencode+codex-cli+codex-app,set:profiles=true,set:memory=postgres,set:name=app-demo,set:apply=false,submit"
    }
  });
  const appTuiOutput = `${appTuiPreview.stdout}\n${appTuiPreview.stderr}`;
  assert.equal(appTuiPreview.status, 0, appTuiPreview.stderr);
  assert.match(appTuiOutput, /Alfred installer/);
  assert.match(appTuiOutput, /OS: /);
  assert.match(appTuiOutput, /Node: /);
  assert.match(appTuiOutput, /Provider\/model suggestions:/);
  assert.match(appTuiOutput, /Git: /);
  assert.match(appTuiOutput, /Use recommended setup/);
  assert.match(appTuiOutput, /Phase 1\/5: Discover/);
  assert.match(appTuiOutput, /layout: inline/, "install.sh forwards the inherited inline layout selector");
  assert.match(appTuiOutput, /Preview: Full \| opencode, Codex CLI, Codex App/);
  assert.match(appTuiOutput, /p full Preview/);
  assert.match(appTuiOutput, /provider calls: 0/);
  assert.doesNotMatch(appTuiPreview.stderr, /\x1b\[[0-?]*[ -/]*[@-~]/, "redirected playback render must not emit ANSI color");
  assert.match(appTuiPreview.stdout, /ALFRED SUITE INSTALL PREVIEW/);
  assert.match(appTuiPreview.stdout, /Edition:\s+full/);
  assert.match(appTuiPreview.stdout, /Harnesses:\s+opencode,codex-cli,codex-app/);
  assert.match(appTuiPreview.stdout, /Detected:\s+opencode \[/);
  assert.match(appTuiPreview.stdout, /Profile:\s+runtime-profiles/);
  assert.match(appTuiPreview.stdout, /Memory setup:\s+postgres/);
  assert.match(appTuiPreview.stdout, /Name:\s+app-demo/);
  assert.match(appTuiPreview.stdout, /TUI used:\s+true/);
  assert.match(appTuiPreview.stdout, /TUI mode:\s+app/);
  assert.equal(existsSync(join(home, ".alfred")), false, "app TUI preview must not create ~/.alfred");
  assert.deepEqual(readdirSync(appTuiTemp), [], "private app TUI temp directory must be cleaned after success");

  const forcedColorRender = spawnSync("node", [appTui], {
    cwd,
    env: {
      ...process.env,
      ALFRED_INSTALL_APP_TUI_EVENTS: "submit",
      ALFRED_INSTALL_APP_TUI_RENDER: "1",
      ALFRED_INSTALL_FORCE_COLOR: "1"
    },
    encoding: "utf8"
  });
  assert.equal(forcedColorRender.status, 0, forcedColorRender.stderr);
  assert.match(forcedColorRender.stderr, /\x1b\[[0-?]*[ -/]*[@-~]/, "tests can explicitly force color for redirected playback");

  const inlinePlaybackRender = spawnSync("node", [appTui], {
    cwd,
    env: {
      ...process.env,
      ALFRED_INSTALL_APP_TUI_LAYOUT: "inline",
      ALFRED_INSTALL_APP_TUI_EVENTS: "submit",
      ALFRED_INSTALL_APP_TUI_RENDER: "1"
    },
    encoding: "utf8"
  });
  assert.equal(inlinePlaybackRender.status, 0, inlinePlaybackRender.stderr);
  assert.match(inlinePlaybackRender.stderr, /layout: inline/, "layout selection is deterministic without a TTY");
  assert.doesNotMatch(inlinePlaybackRender.stderr, /\x1b\[\?1049|\x1b\[\?1000|\x1b\[\?1006|\x1b\[2J/);

  const unknownLayoutRender = spawnSync("node", [appTui], {
    cwd,
    env: {
      ...process.env,
      ALFRED_INSTALL_APP_TUI_LAYOUT: "unknown-layout",
      ALFRED_INSTALL_APP_TUI_EVENTS: "submit",
      ALFRED_INSTALL_APP_TUI_RENDER: "1"
    },
    encoding: "utf8"
  });
  assert.equal(unknownLayoutRender.status, 0, unknownLayoutRender.stderr);
  assert.match(unknownLayoutRender.stderr, /layout: fullscreen/, "unknown layout values safely normalize to fullscreen");

  const modeNodeBin = join(fixture, "mode-node-bin");
  const modeTuiTemp = join(fixture, "mode-tui-tmp");
  const modeMarker = join(fixture, "private-modes.txt");
  mkdirSync(modeNodeBin, { recursive: true });
  mkdirSync(modeTuiTemp, { recursive: true });
  writeFileSync(join(modeNodeBin, "node"), `#!/bin/sh
case "$1" in
  *install-app.mjs)
    private_dir=$(dirname "$1")
    dir_mode=$(stat -f '%Lp' "$private_dir" 2>/dev/null || stat -c '%a' "$private_dir")
    discovery_mode=$(stat -f '%Lp' "$private_dir/discovery.json" 2>/dev/null || stat -c '%a' "$private_dir/discovery.json")
    canonical_mode=$(stat -f '%Lp' "$private_dir/model-assignment.mjs" 2>/dev/null || stat -c '%a' "$private_dir/model-assignment.mjs")
    printf '%s %s %s\\n' "$dir_mode" "$discovery_mode" "$canonical_mode" > "$ALFRED_TEST_MODE_MARKER"
    ;;
esac
exec ${shellQuote(process.execPath)} "$@"
`);
  chmodSync(join(modeNodeBin, "node"), 0o755);
  const modePreview = run([], {
    env: {
      PATH: `${modeNodeBin}:${process.env.PATH ?? ""}`,
      TMPDIR: modeTuiTemp,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS: "submit",
      ALFRED_TEST_MODE_MARKER: modeMarker
    }
  });
  assert.equal(modePreview.status, 0, modePreview.stderr);
  assert.equal(readFileSync(modeMarker, "utf8").trim(), "700 600 600");
  assert.deepEqual(readdirSync(modeTuiTemp), [], "private mode probe must still clean staged files");

  const guidedQuickPath = spawnSync("node", [appTui], {
    cwd,
    env: {
      ...process.env,
      ALFRED_INSTALL_HARNESS_STATUS: "opencode=installed,codex-cli=not-installed,codex-app=installed,pi=not-installed",
      ALFRED_INSTALL_APP_TUI_EVENTS: "r,enter,enter"
    },
    encoding: "utf8"
  });
  assert.equal(guidedQuickPath.status, 0, guidedQuickPath.stderr);
  assert.match(guidedQuickPath.stdout, /HARNESS='opencode,codex-app'/);
  assert.match(guidedQuickPath.stdout, /APPLY='false'/);
  assert.match(guidedQuickPath.stdout, /TUI_MODE='app'/);

  const guidedCustomizePath = spawnSync("node", [appTui], {
    cwd,
    env: {
      ...process.env,
      ALFRED_INSTALL_APP_TUI_SCRIPT:
        "down,enter,right,down,space,down,down,down,down,down,enter,right,down,backspace,text:-legacy,down,text:/tmp/legacy,down,right,down,enter,enter,enter"
    },
    encoding: "utf8"
  });
  assert.equal(guidedCustomizePath.status, 0, guidedCustomizePath.stderr);
  assert.match(guidedCustomizePath.stdout, /EDITION='memory'/);
  assert.match(guidedCustomizePath.stdout, /HARNESS='opencode'/);
  assert.match(guidedCustomizePath.stdout, /MEMORY_SETUP='local-sqlite'/);
  assert.match(guidedCustomizePath.stdout, /NAME='acm-legacy'/);
  assert.match(guidedCustomizePath.stdout, /TARGET_PATH='\/tmp\/legacy'/);
  assert.match(guidedCustomizePath.stdout, /APPLY='true'/);

  const appTuiMouseToggle = spawnSync("node", [appTui], {
    cwd,
    env: {
      ...process.env,
      ALFRED_INSTALL_HARNESS_STATUS: "opencode=not-installed,codex-cli=not-installed,codex-app=not-installed,pi=not-installed",
      ALFRED_INSTALL_APP_TUI_EVENTS: "mouse:1:9,submit"
    },
    encoding: "utf8"
  });
  assert.equal(appTuiMouseToggle.status, 0, appTuiMouseToggle.stderr);
  assert.match(appTuiMouseToggle.stdout, /HARNESS='opencode'/);
  assert.match(appTuiMouseToggle.stdout, /TUI_MODE='app'/);

  const appTuiMouseFocus = spawnSync("node", [appTui], {
    cwd,
    env: {
      ...process.env,
      ALFRED_INSTALL_HARNESS_STATUS: "opencode=not-installed,codex-cli=not-installed,codex-app=not-installed,pi=not-installed",
      ALFRED_INSTALL_APP_TUI_EVENTS: "mouse:1:9,right,space,right,enter,submit"
    },
    encoding: "utf8"
  });
  assert.equal(appTuiMouseFocus.status, 0, appTuiMouseFocus.stderr);
  assert.match(appTuiMouseFocus.stdout, /HARNESS='opencode,codex-cli,codex-app'/, "legacy mouse focus must survive arrows, Space, and Enter");

  const appTuiResultFile = join(fixture, "app-tui-result.env");
  const appTuiResult = spawnSync("node", [appTui], {
    cwd,
    env: {
      ...process.env,
      ALFRED_INSTALL_APP_TUI_RESULT_FILE: appTuiResultFile,
      ALFRED_INSTALL_APP_TUI_EVENTS: "set:edition=coding,set:harnesses=opencode+codex-cli,set:name=tty-result,submit"
    },
    encoding: "utf8"
  });
  assert.equal(appTuiResult.status, 0, appTuiResult.stderr);
  assert.equal(appTuiResult.stdout, "");
  const appTuiResultEnv = readFileSync(appTuiResultFile, "utf8");
  assert.match(appTuiResultEnv, /HARNESS='opencode,codex-cli'/);
  assert.match(appTuiResultEnv, /NAME='tty-result'/);
  assert.match(appTuiResultEnv, /TUI_MODE='app'/);

  const quotedResult = run([], {
    env: {
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS: "set:name=O'Reilly,set:apply=false,submit"
    }
  });
  assert.equal(quotedResult.status, 0, quotedResult.stderr);
  assert.match(quotedResult.stdout, /Name:\s+O'Reilly/);
  assert.match(quotedResult.stdout, /TUI mode:\s+app/);

  const unsafeNodeBin = join(fixture, "unsafe-node-bin");
  const unsafeTuiTemp = join(fixture, "unsafe-tui-tmp");
  const unsafeResultMarker = join(fixture, "unsafe-result-executed");
  mkdirSync(unsafeNodeBin, { recursive: true });
  mkdirSync(unsafeTuiTemp, { recursive: true });
  writeFileSync(join(unsafeNodeBin, "node"), `#!/bin/sh
if [ "$1" = "-v" ]; then printf 'v26.0.0\\n'; exit 0; fi
cat <<'EOFRESULT'
EDITION='coding'
HARNESS='none'
PROFILE_STRATEGY='runtime-profiles'
MEMORY_SETUP='not-needed-for-coding-edition'
NAME='safe'$(touch "$ALFRED_TEST_RESULT_MARKER")
APPLY='false'
SKIP_PROFILE_MANAGER='false'
TUI_USED='true'
TUI_MODE='app'
EOFRESULT
`);
  chmodSync(join(unsafeNodeBin, "node"), 0o755);
  const unsafeResult = run([], {
    env: {
      PATH: `${unsafeNodeBin}:/usr/bin:/bin`,
      TMPDIR: unsafeTuiTemp,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS: "submit",
      ALFRED_INSTALL_TUI_INPUT: "1\n5\n1\nsafe-fallback\nn",
      ALFRED_TEST_RESULT_MARKER: unsafeResultMarker
    }
  });
  assert.equal(unsafeResult.status, 0, unsafeResult.stderr);
  assert.match(unsafeResult.stderr, /Rejected unsafe app TUI result/);
  assert.match(unsafeResult.stdout, /TUI mode:\s+text/);
  assert.equal(existsSync(unsafeResultMarker), false, "rejected result assignments must never execute");
  assert.deepEqual(readdirSync(unsafeTuiTemp), [], "private app TUI temp directory must be cleaned after rejection");

  const oldOutputNodeBin = join(fixture, "old-output-node-bin");
  const oldOutputTemp = join(fixture, "old-output-tmp");
  mkdirSync(oldOutputNodeBin, { recursive: true });
  mkdirSync(oldOutputTemp, { recursive: true });
  writeFileSync(join(oldOutputNodeBin, "node"), `#!/bin/sh
if [ "$1" = "-v" ]; then printf 'v26.0.0\\n'; exit 0; fi
cat <<'EOFRESULT'
EDITION='coding'
HARNESS='none'
PROFILE_STRATEGY='runtime-profiles'
MEMORY_SETUP='not-needed-for-coding-edition'
NAME='old-output'
APPLY='false'
SKIP_PROFILE_MANAGER='false'
TUI_USED='true'
TUI_MODE='app'
EOFRESULT
`);
  chmodSync(join(oldOutputNodeBin, "node"), 0o755);
  const oldOutput = run([], {
    env: {
      PATH: `${oldOutputNodeBin}:/usr/bin:/bin`,
      TMPDIR: oldOutputTemp,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS: "submit"
    }
  });
  assert.equal(oldOutput.status, 0, oldOutput.stderr);
  assert.match(oldOutput.stdout, /Name:\s+old-output/);
  assert.match(oldOutput.stdout, /Model strategy:\s+configure-later/);
  assert.match(oldOutput.stdout, /Model approval:\s+false/);
  assert.match(oldOutput.stdout, /TUI mode:\s+app/);
  assert.deepEqual(readdirSync(oldOutputTemp), [], "old app output cleanup must remain intact");

  const invalidModelNodeBin = join(fixture, "invalid-model-node-bin");
  mkdirSync(invalidModelNodeBin, { recursive: true });
  writeFileSync(join(invalidModelNodeBin, "node"), `#!/bin/sh
if [ "$1" = "-v" ]; then printf 'v26.0.0\\n'; exit 0; fi
cat <<'EOFRESULT'
EDITION='coding'
HARNESS='none'
PROFILE_STRATEGY='runtime-profiles'
MEMORY_SETUP='not-needed-for-coding-edition'
NAME='invalid-model'
APPLY='false'
SKIP_PROFILE_MANAGER='false'
TUI_USED='true'
TUI_MODE='app'
MODEL_STRATEGY='invented-policy'
MODEL_WRITE_APPROVED='yes'
EOFRESULT
`);
  chmodSync(join(invalidModelNodeBin, "node"), 0o755);
  const invalidModelOutput = run([], {
    env: {
      PATH: `${invalidModelNodeBin}:/usr/bin:/bin`,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS: "submit",
      ALFRED_INSTALL_TUI_INPUT: "1\n5\n1\nfallback-after-invalid\nn"
    }
  });
  assert.notEqual(invalidModelOutput.status, 0, "invalid optional IPC values must fail closed");
  assert.match(invalidModelOutput.stderr, /Invalid MODEL_STRATEGY|Invalid MODEL_WRITE_APPROVED/);

  const multiFlagPreview = run(["--edition=coding", "--name=multi", "--harness=opencode,codex-cli,codex-app"]);
  assert.equal(multiFlagPreview.status, 0, multiFlagPreview.stderr);
  assert.match(multiFlagPreview.stdout, /Harnesses:\s+opencode,codex-cli,codex-app/);
  assert.match(multiFlagPreview.stdout, /Detected:\s+opencode \[/);

  const fakeBin = join(fixture, "fake-bin");
  const fakeCodexApp = join(fixture, "Codex.app");
  mkdirSync(fakeBin, { recursive: true });
  mkdirSync(fakeCodexApp, { recursive: true });
  writeFileSync(join(fakeBin, "opencode"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(fakeBin, "opencode"), 0o755);
  const autoPreview = run(["--edition=coding", "--name=auto", "--harness=auto"], {
    env: {
      PATH: `${fakeBin}:/usr/bin:/bin`,
      CODEX_APP_HOME: fakeCodexApp
    }
  });
  assert.equal(autoPreview.status, 0, autoPreview.stderr);
  assert.match(autoPreview.stdout, /Harnesses:\s+opencode,codex-app/);
  assert.match(autoPreview.stdout, /opencode \[installed\]/);
  assert.match(autoPreview.stdout, /codex-cli \[not-installed\]/);
  assert.match(autoPreview.stdout, /codex-app \[installed\]/);
  assert.match(autoPreview.stdout, /pi \[not-installed\]/);

  const tuiFull = run([], {
    env: {
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_TUI_INPUT: "3\n5\n1\n3\nacme\nn"
    }
  });
  const tuiFullOutput = `${tuiFull.stdout}\n${tuiFull.stderr}`;
  assert.equal(tuiFull.status, 0, tuiFull.stderr);
  assert.match(tuiFullOutput, /ALFRED HUMAN-FIRST INSTALLER/);
  assert.match(tuiFullOutput, /Choose an edition/);
  assert.match(tuiFullOutput, /coding\s+\(recommended for agent work\)/);
  assert.match(tuiFullOutput, /memory/);
  assert.match(tuiFullOutput, /full/);
  assert.match(tuiFullOutput, /Choose a harness target/);
  assert.match(tuiFullOutput, /Choose a runtime profile strategy/);
  assert.match(tuiFullOutput, /Choose a Memory setup strategy/);
  assert.match(tuiFullOutput, /--name is a local human-readable install\/context identifier/);
  assert.match(tuiFullOutput, /ALFRED SUITE INSTALL PREVIEW/);
  assert.match(tuiFullOutput, /Edition:\s+full/);
  assert.match(tuiFullOutput, /Harnesses:\s+none/);
  assert.match(tuiFullOutput, /Profile:\s+runtime-profiles/);
  assert.match(tuiFullOutput, /Memory setup:\s+postgres/);
  assert.match(tuiFullOutput, /Name:\s+acme/);
  assert.match(tuiFullOutput, /TUI used:\s+true/);
  assert.match(tuiFullOutput, /No files were written/);
  assert.equal(existsSync(join(home, ".alfred")), false, "TUI preview must not create ~/.alfred");

  const tuiMultiHarness = run([], {
    env: {
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_TUI_INPUT: "1\n2,3\n1\nmulti-text\nn"
    }
  });
  const tuiMultiHarnessOutput = `${tuiMultiHarness.stdout}\n${tuiMultiHarness.stderr}`;
  assert.equal(tuiMultiHarness.status, 0, tuiMultiHarness.stderr);
  assert.match(tuiMultiHarnessOutput, /comma-separated/);
  assert.match(tuiMultiHarness.stdout, /Edition:\s+coding/);
  assert.match(tuiMultiHarness.stdout, /Harnesses:\s+opencode,codex-cli,codex-app/);
  assert.match(tuiMultiHarness.stdout, /Name:\s+multi-text/);
  assert.match(tuiMultiHarness.stdout, /TUI mode:\s+text/);

  const tuiDecideLater = run([], {
    env: {
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_TUI_INPUT: "1\n5\n2\nwork-laptop\nn"
    }
  });
  assert.equal(tuiDecideLater.status, 0, tuiDecideLater.stderr);
  assert.match(tuiDecideLater.stdout, /Edition:\s+coding/);
  assert.match(tuiDecideLater.stdout, /Profile:\s+decide-later/);
  assert.match(tuiDecideLater.stdout, /Components:\s+core,agents,skills,opencode-adapter,codex-adapter,evals/);
  assert.doesNotMatch(tuiDecideLater.stdout, /Components:.*profile-manager/);

  const legacy = run(["--profile=coding", "--name=acme"]);
  assert.notEqual(legacy.status, 0);
  assert.match(legacy.stderr, /--profile is legacy/);

  const unknown = run(["--edition=coding", "--name=acme", "--surprise"]);
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /Unknown flag: --surprise/);

  const target = join(fixture, "existing-alfred-repo");
  mkdirSync(target, { recursive: true });
  const applied = run(["--edition=coding", "--name=acme", "--path", target, "--apply", "--no-clone", "--harness=opencode,codex-cli"]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /ALFRED SUITE INSTALL APPLIED/);
  assert.match(applied.stdout, /Final handoff choices:/);
  assert.match(applied.stdout, /Non-interactive install: no project files were copied/);
  assert.equal(existsSync(join(home, ".alfred", "runtime-profiles", "profiles")), true);
  assert.equal(existsSync(join(home, ".alfred", "runtime-profiles", "profiles.local")), true);
  assert.equal(existsSync(join(home, ".alfred", "observability", "install-trace.json")), true);
  const trace = JSON.parse(readFileSync(join(home, ".alfred", "observability", "install-trace.json"), "utf8"));
  assert.equal(trace.actor, "alfred-suite-install");
  assert.equal(trace.data.edition, "coding");
  assert.equal(trace.data.harnesses, "opencode,codex-cli");
  assert.match(trace.data.harness_status, /opencode=/);
  assert.equal(trace.data.provider_calls, 0);
  assert.match(applied.stdout, /configure later; no model configuration will be written/);
  assert.equal(existsSync(join(home, ".alfred", "models.json")), false, "configure-later apply must not write model config");

  const handoffTarget = join(fixture, "handoff-alfred-repo");
  mkdirSync(join(handoffTarget, "packages", "opencode-adapter", "src"), { recursive: true });
  mkdirSync(join(handoffTarget, "packages", "codex-adapter", "src"), { recursive: true });
  writeFileSync(
    join(handoffTarget, "packages", "opencode-adapter", "src", "cli.js"),
    "const fs = require('fs'); const path = require('path'); const output = process.argv[process.argv.indexOf('--output') + 1]; fs.mkdirSync(path.join(output, '.opencode', 'agents'), { recursive: true }); fs.writeFileSync(path.join(output, 'opencode.json.preview'), '{}\\n'); fs.writeFileSync(path.join(output, '.opencode', 'agents', 'orchestrator.md'), '# orchestrator\\n');\n"
  );
  writeFileSync(
    join(handoffTarget, "packages", "codex-adapter", "src", "cli.js"),
    "const fs = require('fs'); const path = require('path'); const output = process.argv[process.argv.indexOf('--output') + 1]; fs.mkdirSync(path.join(output, '.codex', 'agents'), { recursive: true }); fs.mkdirSync(path.join(output, '.agents', 'skills', 'typescript-project'), { recursive: true }); fs.writeFileSync(path.join(output, '.codex', 'agents', 'developer.toml'), 'name = \"developer\"\\n'); fs.writeFileSync(path.join(output, '.agents', 'skills', 'typescript-project', 'SKILL.md'), '# TypeScript\\n');\n"
  );
  const handoffCopy = run(["--no-clone"], {
    env: {
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS: `set:edition=coding,set:harnesses=opencode+codex-cli,set:profiles=true,set:name=copy-demo,set:path=${handoffTarget},set:apply=true,submit`,
      ALFRED_INSTALL_HANDOFF_INPUT: "2"
    }
  });
  assert.equal(handoffCopy.status, 0, handoffCopy.stderr);
  assert.match(handoffCopy.stdout, /ALFRED INSTALL COMPLETE/);
  assert.match(handoffCopy.stdout, /Final handoff choices:/);
  assert.match(handoffCopy.stdout, /Project files:\s+Not copied yet/);
  assert.match(handoffCopy.stdout, /Apply selected harness files into this project now/);
  assert.doesNotMatch(handoffCopy.stdout, /Where files go and why:/);
  assert.match(handoffCopy.stdout, /Applied selected harness files into this project:/);
  assert.match(handoffCopy.stdout, /<project>\/.opencode/);
  assert.match(handoffCopy.stdout, /<project>\/opencode.json/);
  assert.match(handoffCopy.stdout, /<project>\/.codex/);
  assert.match(handoffCopy.stdout, /<project>\/.agents/);
  assert.match(handoffCopy.stdout, /No global user-level harness config was written/);
  assert.equal(
    existsSync(join(cwd, "opencode.json")),
    true,
    "handoff copy should place opencode config in the project final location"
  );
  assert.equal(
    existsSync(join(cwd, ".opencode", "agents", "orchestrator.md")),
    true,
    "handoff copy should place opencode agents in the project final location"
  );
  assert.equal(
    existsSync(join(cwd, ".codex", "agents", "developer.toml")),
    true,
    "handoff copy should place Codex agents in the project final location"
  );
  assert.equal(
    existsSync(join(cwd, ".agents", "skills", "typescript-project", "SKILL.md")),
    true,
    "handoff copy should place Codex skills in the project final location"
  );

  const gitProbe = spawnSync("git", ["--version"], { encoding: "utf8" });
  assert.equal(gitProbe.status, 0, "git is required for the real linked-worktree installer integration test");
  const worktreeMain = join(fixture, "worktree-main");
  const worktreeLinked = join(fixture, "worktree-linked");
  const worktreeTarget = join(fixture, "worktree-alfred-target");
  const worktreeHome = join(fixture, "worktree-home");
  mkdirSync(worktreeMain, { recursive: true });
  mkdirSync(worktreeHome, { recursive: true });
  assert.equal(spawnSync("git", ["init"], { cwd: worktreeMain, encoding: "utf8" }).status, 0);
  writeFileSync(join(worktreeMain, "README.md"), "# worktree fixture\n");
  assert.equal(spawnSync("git", ["add", "README.md"], { cwd: worktreeMain, encoding: "utf8" }).status, 0);
  const initialCommit = spawnSync("git", ["-c", "user.name=Alfred Test", "-c", "user.email=alfred@example.invalid", "commit", "-m", "fixture"], { cwd: worktreeMain, encoding: "utf8" });
  assert.equal(initialCommit.status, 0, initialCommit.stderr);
  const addWorktree = spawnSync("git", ["worktree", "add", "-b", "issue-95-fixture", worktreeLinked], { cwd: worktreeMain, encoding: "utf8" });
  assert.equal(addWorktree.status, 0, addWorktree.stderr);
  const worktreeMainCanonical = realpathSync(worktreeMain);
  const worktreeLinkedCanonical = realpathSync(worktreeLinked);
  mkdirSync(join(worktreeTarget, "packages", "opencode-adapter", "src"), { recursive: true });
  writeFileSync(
    join(worktreeTarget, "packages", "opencode-adapter", "src", "cli.js"),
    "const fs = require('fs'); const path = require('path'); const output = process.argv[process.argv.indexOf('--output') + 1]; fs.mkdirSync(path.join(output, '.opencode', 'agents'), { recursive: true }); fs.writeFileSync(path.join(output, 'opencode.json.preview'), '{}\\n'); fs.writeFileSync(path.join(output, '.opencode', 'agents', 'reviewer.md'), '# reviewer\\n');\n"
  );
  const worktreeApply = run(["--no-clone"], {
    cwd: worktreeLinked,
    env: {
      HOME: worktreeHome,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_RENDER: "1",
      ALFRED_INSTALL_APP_TUI_COLUMNS: "240",
      ALFRED_INSTALL_APP_TUI_EVENTS: `set:edition=coding,set:harnesses=opencode,set:profiles=false,set:name=worktree,set:path=${worktreeTarget},set:apply=true,submit`,
      ALFRED_INSTALL_HANDOFF_INPUT: "2"
    }
  });
  assert.equal(worktreeApply.status, 0, worktreeApply.stderr);
  assert.match(worktreeApply.stderr, new RegExp(`Project root: ${worktreeMainCanonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "discovery displays the shell-resolved canonical root");
  assert.equal(existsSync(join(worktreeMain, ".opencode", "agents", "reviewer.md")), true, "handoff applies harness files to the canonical main worktree");
  assert.equal(existsSync(join(worktreeMain, "opencode.json")), true);
  assert.equal(existsSync(join(worktreeLinked, ".opencode")), false, "linked invoking worktree is not used as the apply target");
  assert.equal(existsSync(join(worktreeLinked, "opencode.json")), false);
  const worktreeHandoff = readFileSync(join(worktreeTarget, ".ai", "generated", "install-handoff.txt"), "utf8");
  assert.match(worktreeHandoff, new RegExp(`Project launched from: ${worktreeLinkedCanonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.match(worktreeHandoff, new RegExp(`Canonical project root: ${worktreeMainCanonical.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));

  const installSource = readFileSync(installSh, "utf8");
  for (const requiredRemote of [
    "scripts/tui/install-discovery.mjs",
    "packages/profile-manager/src/index.js",
    "packages/core/src/model-assignment.js"
  ]) assert.match(installSource, new RegExp(requiredRemote.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(installSource, /chmod 0700 "\$APP_TUI_PRIVATE_DIR"/);
  assert.match(installSource, /chmod 0600 "\$app_discovery_file"/);
  assert.match(installSource, /ALFRED_INSTALL_DISCOVERY_FILE=/);
  assert.match(installSource, /https:\/\/api\.github\.com\/repos\/GOI17\/alfred\/git\/ref\/heads\/\$DEFAULT_BRANCH/);
  assert.match(installSource, /https:\/\/codeload\.github\.com\/GOI17\/alfred\/tar\.gz\/\$app_tui_commit_sha/);
  assert.doesNotMatch(installSource, /codeload\.github\.com\/GOI17\/alfred\/tar\.gz\/refs\/heads/);

  const remoteRoot = join(fixture, "remote-bootstrap");
  const remoteBin = join(remoteRoot, "bin");
  const remoteTmp = join(remoteRoot, "tmp");
  const remoteHome = join(remoteRoot, "home");
  const remoteCwd = join(remoteRoot, "workspace");
  const remoteInstaller = join(remoteRoot, "install.sh");
  const remoteSnapshot = join(remoteRoot, "snapshot.tar.gz");
  const remoteSnapshotRoot = join(remoteRoot, "snapshot-source", "alfred-main");
  const curlMarker = join(remoteRoot, "curl.log");
  const tarMarker = join(remoteRoot, "tar.log");
  const remoteCommitSha = "0123456789abcdef0123456789abcdef01234567";
  for (const directory of [remoteBin, remoteTmp, remoteHome, remoteCwd]) mkdirSync(directory, { recursive: true });
  writeFileSync(remoteInstaller, installSource);
  for (const relativePath of [
    "scripts/tui/install-app.mjs",
    "scripts/tui/install-pathfinder.mjs",
    "scripts/tui/install-discovery.mjs",
    "packages/profile-manager/src/index.js",
    "packages/core/src/model-assignment.js"
  ]) {
    const destination = join(remoteSnapshotRoot, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, relativePath), destination);
  }
  const tarPath = spawnSync("sh", ["-c", "command -v tar"], { encoding: "utf8" }).stdout.trim();
  assert.ok(tarPath, "tar is required for deterministic remote bootstrap coverage");
  const packed = spawnSync(tarPath, ["-czf", remoteSnapshot, "alfred-main"], { cwd: join(remoteRoot, "snapshot-source"), encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  writeFileSync(join(remoteBin, "curl"), `#!/bin/sh
output=''
url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf '%s\n' "$url" >> "$ALFRED_TEST_CURL_MARKER"
case "$url" in
  https://api.github.com/*)
    printf '{"object":{"type":"commit","sha":"%s"}}\n' "$ALFRED_TEST_COMMIT_SHA" > "$output"
    ;;
  https://codeload.github.com/*)
    [ "\${ALFRED_TEST_FAIL_CODELOAD:-0}" != "1" ] || exit 1
    cp "$ALFRED_TEST_SNAPSHOT" "$output"
    ;;
  *) exit 1 ;;
esac
`);
  writeFileSync(join(remoteBin, "tar"), `#!/bin/sh
printf '%s\n' "$*" >> "$ALFRED_TEST_TAR_MARKER"
exec ${shellQuote(tarPath)} "$@"
`);
  chmodSync(join(remoteBin, "curl"), 0o755);
  chmodSync(join(remoteBin, "tar"), 0o755);
  const remoteBootstrap = run([], {
    installSh: remoteInstaller,
    cwd: remoteCwd,
    env: {
      HOME: remoteHome,
      PATH: `${remoteBin}:${process.env.PATH ?? ""}`,
      TMPDIR: remoteTmp,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS: "submit",
      ALFRED_TEST_COMMIT_SHA: remoteCommitSha,
      ALFRED_TEST_SNAPSHOT: remoteSnapshot,
      ALFRED_TEST_CURL_MARKER: curlMarker,
      ALFRED_TEST_TAR_MARKER: tarMarker
    }
  });
  assert.equal(remoteBootstrap.status, 0, remoteBootstrap.stderr);
  assert.match(remoteBootstrap.stdout, /TUI mode:\s+app/, "remote snapshot modules import successfully");
  const curlRequests = readFileSync(curlMarker, "utf8").trim().split("\n");
  assert.deepEqual(curlRequests, [
    "https://api.github.com/repos/GOI17/alfred/git/ref/heads/main",
    `https://codeload.github.com/GOI17/alfred/tar.gz/${remoteCommitSha}`
  ], "remote bootstrap resolves the branch once and fetches that exact commit snapshot");
  assert.doesNotMatch(curlRequests[1], /refs\/heads\/main/, "codeload must not fetch the mutable branch URL");
  assert.match(readFileSync(tarMarker, "utf8"), /-xzf/);
  assert.deepEqual(readdirSync(remoteTmp), [], "remote private staging is removed after successful imports");

  const invalidShaMarker = join(remoteRoot, "invalid-sha-curl.log");
  const invalidShaBootstrap = run([], {
    installSh: remoteInstaller,
    cwd: remoteCwd,
    env: {
      HOME: remoteHome,
      PATH: `${remoteBin}:${process.env.PATH ?? ""}`,
      TMPDIR: remoteTmp,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_TUI_INPUT: "1\n5\n1\ninvalid-sha-fallback\nn",
      ALFRED_TEST_COMMIT_SHA: "not-a-commit-sha",
      ALFRED_TEST_SNAPSHOT: remoteSnapshot,
      ALFRED_TEST_CURL_MARKER: invalidShaMarker
    }
  });
  assert.equal(invalidShaBootstrap.status, 0, invalidShaBootstrap.stderr);
  assert.match(invalidShaBootstrap.stderr, /using text installer/i, "invalid branch resolution falls back safely");
  assert.match(invalidShaBootstrap.stdout, /TUI mode:\s+text/);
  assert.deepEqual(readFileSync(invalidShaMarker, "utf8").trim().split("\n"), [
    "https://api.github.com/repos/GOI17/alfred/git/ref/heads/main"
  ], "an invalid SHA must stop before codeload");
  assert.deepEqual(readdirSync(remoteTmp), [], "failed branch resolution cleans private staging");

  const failedStagingMarker = join(remoteRoot, "failed-staging-curl.log");
  const failedStagingBootstrap = run([], {
    installSh: remoteInstaller,
    cwd: remoteCwd,
    env: {
      HOME: remoteHome,
      PATH: `${remoteBin}:${process.env.PATH ?? ""}`,
      TMPDIR: remoteTmp,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_TUI_INPUT: "1\n5\n1\nfailed-staging-fallback\nn",
      ALFRED_TEST_COMMIT_SHA: remoteCommitSha,
      ALFRED_TEST_FAIL_CODELOAD: "1",
      ALFRED_TEST_SNAPSHOT: remoteSnapshot,
      ALFRED_TEST_CURL_MARKER: failedStagingMarker
    }
  });
  assert.equal(failedStagingBootstrap.status, 0, failedStagingBootstrap.stderr);
  assert.match(failedStagingBootstrap.stderr, /using text installer/i, "failed immutable snapshot staging falls back safely");
  assert.match(failedStagingBootstrap.stdout, /TUI mode:\s+text/);
  assert.deepEqual(readFileSync(failedStagingMarker, "utf8").trim().split("\n"), [
    "https://api.github.com/repos/GOI17/alfred/git/ref/heads/main",
    `https://codeload.github.com/GOI17/alfred/tar.gz/${remoteCommitSha}`
  ]);
  assert.deepEqual(readdirSync(remoteTmp), [], "failed snapshot staging cleans private staging");

  function writeDiscoveryFixture(filePath, { fixtureHome, fixtureTarget, existingModels = false }) {
    const modelsPath = join(fixtureHome, ".alfred", "models.json");
    writeFileSync(filePath, `${JSON.stringify({
      homeDir: fixtureHome,
      cwd,
      targetPath: fixtureTarget,
      env: {
        PATH: "/fixture/bin",
        OPENAI_API_KEY: "fixture-openai-secret",
        ANTHROPIC_API_KEY: "fixture-anthropic-secret"
      },
      platform: "linux",
      release: "fixture-release",
      architecture: "arm64",
      nodeVersion: "v24.3.0",
      commands: { git: false, opencode: true, codex: false, pi: false },
      existing_paths: [fixtureTarget, ...(existingModels ? [modelsPath] : [])]
    }, null, 2)}\n`);
  }

  const modelPreviewHome = join(fixture, "model-preview-home");
  const modelPreviewTarget = join(fixture, "model-preview-target");
  const modelPreviewFixture = join(fixture, "model-preview-fixture.json");
  mkdirSync(modelPreviewHome, { recursive: true });
  mkdirSync(modelPreviewTarget, { recursive: true });
  writeDiscoveryFixture(modelPreviewFixture, { fixtureHome: modelPreviewHome, fixtureTarget: modelPreviewTarget });
  const modelPreview = run([], {
    env: {
      HOME: modelPreviewHome,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS: "submit",
      ALFRED_INSTALL_DISCOVERY_FIXTURE_FILE: modelPreviewFixture
    }
  });
  assert.equal(modelPreview.status, 0, modelPreview.stderr);
  assert.match(modelPreview.stdout, /Model strategy:\s+smart-defaults/);
  assert.match(modelPreview.stdout, /Proposed model configuration \(local discovery only\)/);
  assert.match(modelPreview.stdout, /"primary": "openai\/gpt-4\.1-mini"/);
  assert.doesNotMatch(`${modelPreview.stdout}\n${modelPreview.stderr}`, /fixture-openai-secret|fixture-anthropic-secret/);
  assert.equal(existsSync(join(modelPreviewHome, ".alfred", "models.json")), false, "preview must not write model config");

  const cancelHome = join(fixture, "model-cancel-home");
  const cancelFixture = join(fixture, "model-cancel-fixture.json");
  const cancelWorkspace = join(fixture, "cancel-workspace");
  const cancelTmp = join(fixture, "cancel-tmp");
  mkdirSync(cancelHome, { recursive: true });
  mkdirSync(cancelWorkspace, { recursive: true });
  mkdirSync(cancelTmp, { recursive: true });
  writeDiscoveryFixture(cancelFixture, { fixtureHome: cancelHome, fixtureTarget: modelPreviewTarget });
  const cancelledModel = run([], {
    cwd: cancelWorkspace,
    env: {
      HOME: cancelHome,
      TMPDIR: cancelTmp,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_LAYOUT: "inline",
      ALFRED_INSTALL_APP_TUI_EVENTS: "q",
      ALFRED_INSTALL_DISCOVERY_FIXTURE_FILE: cancelFixture
    }
  });
  assert.equal(cancelledModel.status, 130, "q must terminate the overall installer instead of entering text fallback");
  assert.doesNotMatch(`${cancelledModel.stdout}\n${cancelledModel.stderr}`, /using text installer|ALFRED HUMAN-FIRST INSTALLER/i, "inline cancellation must not run text fallback");
  assert.equal(existsSync(join(cancelHome, ".alfred", "models.json")), false, "cancel must not write model config");
  assert.equal(existsSync(join(cancelHome, ".alfred", "runtime-profiles")), false, "cancel must not write profiles");
  assert.deepEqual(readdirSync(cancelWorkspace), [], "cancel must not write project files");
  assert.deepEqual(readdirSync(cancelTmp), [], "cancel must clean private staging");

  const keepHome = join(fixture, "model-keep-home");
  const keepTarget = join(fixture, "model-keep-target");
  const keepFixture = join(fixture, "model-keep-fixture.json");
  const keepModels = join(keepHome, ".alfred", "models.json");
  mkdirSync(join(keepHome, ".alfred"), { recursive: true });
  mkdirSync(keepTarget, { recursive: true });
  writeFileSync(keepModels, "{\n  \"*\": { \"primary\": \"existing/model\" },\n  \"fallbacks\": []\n}\n", { mode: 0o600 });
  const keepBefore = readFileSync(keepModels, "utf8");
  writeDiscoveryFixture(keepFixture, { fixtureHome: keepHome, fixtureTarget: keepTarget, existingModels: true });
  const keepApply = run(["--path", keepTarget, "--no-clone"], {
    env: {
      HOME: keepHome,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS: "r,set:applyIntent=apply-safe-steps,enter,enter",
      ALFRED_INSTALL_DISCOVERY_FIXTURE_FILE: keepFixture
    }
  });
  assert.equal(keepApply.status, 0, keepApply.stderr);
  assert.match(keepApply.stdout, /Model strategy:\s+keep-existing/);
  assert.match(keepApply.stdout, /remains untouched and was not read into the TUI/);
  assert.doesNotMatch(keepApply.stdout, /Proposed model configuration|"primary"/);
  assert.equal(readFileSync(keepModels, "utf8"), keepBefore, "keep-existing apply must preserve existing config byte-for-byte");

  const approvedHome = join(fixture, "model-approved-home");
  const approvedTarget = join(fixture, "model-approved-target");
  const approvedFixture = join(fixture, "model-approved-fixture.json");
  mkdirSync(approvedHome, { recursive: true });
  mkdirSync(approvedTarget, { recursive: true });
  writeDiscoveryFixture(approvedFixture, { fixtureHome: approvedHome, fixtureTarget: approvedTarget });
  const approvedApply = run(["--path", approvedTarget, "--no-clone"], {
    env: {
      HOME: approvedHome,
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS: "r,set:applyIntent=apply-safe-steps,space,down,enter,down,enter",
      ALFRED_INSTALL_DISCOVERY_FIXTURE_FILE: approvedFixture,
      ALFRED_INSTALL_HANDOFF_INPUT: "1"
    }
  });
  assert.equal(approvedApply.status, 0, approvedApply.stderr);
  assert.match(approvedApply.stdout, /Model strategy:\s+smart-defaults/);
  assert.match(approvedApply.stdout, /Model approval:\s+true/);
  assert.match(approvedApply.stdout, /Wrote approved model assignment config atomically/);
  const approvedModelsPath = join(approvedHome, ".alfred", "models.json");
  const approvedConfig = JSON.parse(readFileSync(approvedModelsPath, "utf8"));
  assert.deepEqual(approvedConfig, {
    "*": { primary: "openai/gpt-4.1-mini", fallbacks: ["anthropic/claude-sonnet-4"] },
    orchestrator: { primary: "anthropic/claude-sonnet-4" },
    developer: { primary: "anthropic/claude-sonnet-4" },
    fallbacks: ["openai/gpt-4.1-mini", "anthropic/claude-sonnet-4"]
  });
  assert.equal(statSync(approvedModelsPath).mode & 0o777, 0o600, "models config must be mode 0600");
  assert.equal(readdirSync(join(approvedHome, ".alfred")).some((name) => name.includes("models.json") && name.endsWith(".tmp")), false, "atomic model write must leave no temp file");
  const modelTracePath = join(approvedHome, ".alfred", "observability", "model-assignment-trace.json");
  const modelTrace = JSON.parse(readFileSync(modelTracePath, "utf8"));
  assert.deepEqual(modelTrace.trace_events.map((event) => event.event), ["model_assignment_configured", "provider_request_avoided"]);
  assert.equal(modelTrace.provider_calls, 0);
  assert.equal(statSync(modelTracePath).mode & 0o777, 0o600);
  const approvedInstallTrace = JSON.parse(readFileSync(join(approvedHome, ".alfred", "observability", "install-trace.json"), "utf8"));
  assert.equal(approvedInstallTrace.data.model_strategy, "smart-defaults");
  assert.equal(approvedInstallTrace.data.model_write_approved, true);
  assert.equal(approvedInstallTrace.data.model_config_written, true);
  assert.equal(approvedInstallTrace.data.provider_calls, 0);

  console.log("suite installer validation ok: preview is default, legacy flags fail closed, and apply does not install Pi by default");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
