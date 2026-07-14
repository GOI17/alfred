#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const installSh = resolve(root, "install.sh");
const appTui = resolve(root, "scripts/tui/install-app.mjs");
const pathfinder = resolve(root, "scripts/tui/install-pathfinder.mjs");
const pathfinderTest = resolve(root, "scripts/tui/install-pathfinder.test.mjs");
const fixture = mkdtempSync(join(tmpdir(), "alfred-suite-install-"));
const home = join(fixture, "home");
const cwd = join(fixture, "workspace");
mkdirSync(home, { recursive: true });
mkdirSync(cwd, { recursive: true });

function run(args, options = {}) {
  return spawnSync("sh", [installSh, ...args], {
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

function runInteractiveLifecycle(mode) {
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
      env: { ...process.env },
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
      rejectPromise(new Error(`interactive ${mode} lifecycle timed out`));
    }, 4000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (started || !stdout.includes("\x1b[?1049h")) return;
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
    const probe = spawnSync(command, ["-c", "import sys; assert sys.version_info[0] >= 3; import os, pty, select, signal"], { encoding: "utf8" });
    if (!probe.error && probe.status === 0) return command;
  }
  return null;
}

function runPythonPtyLifecycle(command) {
  const pythonScript = String.raw`
import os
import pty
import select
import signal
import sys
import time

node, app = sys.argv[1], sys.argv[2]
enter = b"\x1b[?1049h"
restore = b"\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l"

def run_case(mode, expected):
    pid, fd = pty.fork()
    if pid == 0:
        os.execve(node, [node, app], os.environ.copy())
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
        if not sent and enter in output:
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
        raise AssertionError(mode + " PTY lifecycle timed out")
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
    assert sent, mode + " never entered alternate-screen mode"
    assert code == expected, "%s exited %s, expected %s" % (mode, code, expected)
    assert restore in output, mode + " did not emit terminal restoration"
    if mode == "normal":
        assert b"TUI_MODE='app'" in output, "normal PTY completion lost result assignments"

run_case("normal", 0)
run_case("cancel", 130)
run_case("signal", 143)
print("real PTY lifecycle tests ok (Python pty)")
`;
  const result = spawnSync(command, ["-c", pythonScript, process.execPath, appTui], {
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

function runScriptPtyCase(mode, utilLinux) {
  const wrapper = `${shellQuote(process.execPath)} ${shellQuote(appTui)} & child=$!; printf '__ALFRED_PID__:%s\\n' "$child"; wait "$child"; code=$?; printf '__ALFRED_EXIT__:%s\\n' "$code"; exit "$code"`;
  const args = utilLinux ? ["-qfec", wrapper, "/dev/null"] : ["-q", "/dev/null", "sh", "-c", wrapper];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("script", args, { cwd, env: { ...process.env }, stdio: ["pipe", "pipe", "pipe"] });
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
      rejectPromise(new Error(`script PTY ${mode} lifecycle timed out`));
    }, 5000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const pidMatch = /__ALFRED_PID__:(\d+)/.exec(stdout);
      if (pidMatch) nodePid = Number(pidMatch[1]);
      if (sent || !nodePid || !stdout.includes("\x1b[?1049h")) return;
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
        assert.match(stdout, /\x1b\[\?1006l\x1b\[\?1000l\x1b\[\?25h\x1b\[\?1049l/, `${mode} script PTY did not restore terminal modes`);
        if (mode === "normal") assert.match(stdout, /TUI_MODE='app'/);
        resolvePromise();
      } catch (error) {
        rejectPromise(error);
      }
    });
  });
}

async function runRealPtyLifecycle() {
  const python = pythonPtyCommand();
  if (python) {
    runPythonPtyLifecycle(python);
    return;
  }
  const scriptProbe = spawnSync("script", ["--version"], { encoding: "utf8" });
  if (!scriptProbe.error) {
    const utilLinux = `${scriptProbe.stdout}\n${scriptProbe.stderr}`.includes("util-linux");
    await runScriptPtyCase("normal", utilLinux);
    await runScriptPtyCase("cancel", utilLinux);
    await runScriptPtyCase("signal", utilLinux);
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
  const pathfinderTests = spawnSync("node", [pathfinderTest], { encoding: "utf8" });
  assert.equal(pathfinderTests.status, 0, pathfinderTests.stderr);

  const interactiveNormal = await runInteractiveLifecycle("normal");
  assert.equal(interactiveNormal.code, 0, interactiveNormal.stderr);
  assert.equal(interactiveNormal.signal, null);
  assert.match(interactiveNormal.stdout, /TUI_MODE='app'/);
  assert.match(interactiveNormal.stdout, /\x1b\[\?1006l\x1b\[\?1000l\x1b\[\?25h\x1b\[\?1049l/, "normal completion restores terminal modes");

  const interactiveCancel = await runInteractiveLifecycle("cancel");
  assert.equal(interactiveCancel.code, 130, interactiveCancel.stderr);
  assert.equal(interactiveCancel.signal, null);
  assert.match(interactiveCancel.stdout, /\x1b\[\?1006l\x1b\[\?1000l\x1b\[\?25h\x1b\[\?1049l/, "q cancellation restores terminal modes");

  const interactiveSignal = await runInteractiveLifecycle("signal");
  assert.equal(interactiveSignal.code, 143, interactiveSignal.stderr);
  assert.equal(interactiveSignal.signal, null);
  assert.match(interactiveSignal.stdout, /\x1b\[\?1006l\x1b\[\?1000l\x1b\[\?25h\x1b\[\?1049l/, "SIGTERM restores terminal modes");

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
      ALFRED_INSTALL_APP_TUI_RENDER: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS:
        "set:edition=full,set:harnesses=opencode+codex-cli+codex-app,set:profiles=true,set:memory=postgres,set:name=app-demo,set:apply=false,submit"
    }
  });
  const appTuiOutput = `${appTuiPreview.stdout}\n${appTuiPreview.stderr}`;
  assert.equal(appTuiPreview.status, 0, appTuiPreview.stderr);
  assert.match(appTuiOutput, /Alfred installer/);
  assert.match(appTuiOutput, /Local discovery checked:/);
  assert.match(appTuiOutput, /Use recommended setup/);
  assert.match(appTuiOutput, /Phase 1\/5: Discover/);
  assert.match(appTuiOutput, /Preview: full \| opencode,codex-cli,codex-app/);
  assert.match(appTuiOutput, /p full Preview/);
  assert.match(appTuiOutput, /provider calls: 0/);
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

  console.log("suite installer validation ok: preview is default, legacy flags fail closed, and apply does not install Pi by default");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
