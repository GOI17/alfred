#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = process.cwd();
const installSh = resolve(root, "install.sh");
const appTui = resolve(root, "scripts/tui/install-app.mjs");
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

try {
  const syntax = spawnSync("sh", ["-n", installSh], { encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
  const appSyntax = spawnSync("node", ["--check", appTui], { encoding: "utf8" });
  assert.equal(appSyntax.status, 0, appSyntax.stderr);

  const preview = run(["--edition=coding", "--name=acme"]);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /ALFRED SUITE INSTALL PREVIEW/);
  assert.match(preview.stdout, /Edition:\s+coding/);
  assert.match(preview.stdout, /Name:\s+acme/);
  assert.match(preview.stdout, /No files were written/);
  assert.doesNotMatch(preview.stdout, /Installing Alfred Pi Agent/);
  assert.match(preview.stdout, /TUI used:\s+false/);
  assert.match(preview.stdout, /TUI mode:\s+none/);
  assert.equal(existsSync(join(cwd, "AGENTS.md")), false, "preview must not create AGENTS.md");
  assert.equal(existsSync(join(cwd, ".alfred")), false, "preview must not create .alfred in cwd");

  const appTuiPreview = run([], {
    env: {
      ALFRED_INSTALL_FORCE_TUI: "1",
      ALFRED_INSTALL_APP_TUI_RENDER: "1",
      ALFRED_INSTALL_APP_TUI_EVENTS:
        "set:edition=full,set:harnesses=opencode+codex-cli+codex-app,set:profiles=true,set:memory=postgres,set:name=app-demo,set:apply=false,submit"
    }
  });
  const appTuiOutput = `${appTuiPreview.stdout}\n${appTuiPreview.stderr}`;
  assert.equal(appTuiPreview.status, 0, appTuiPreview.stderr);
  assert.match(appTuiOutput, /Alfred installer/);
  assert.match(appTuiOutput, /app TUI/);
  assert.match(appTuiOutput, /Keyboard: ↑\/↓ move/);
  assert.match(appTuiOutput, /Mouse: click a section/);
  assert.match(appTuiOutput, /opencode \[/);
  assert.match(appTuiOutput, /Codex CLI \[/);
  assert.match(appTuiOutput, /Codex App \[/);
  assert.match(appTuiOutput, /Pi \[/);
  assert.match(appTuiOutput, /☑ Enabled/);
  assert.match(appTuiOutput, /edition=full · harnesses=opencode,codex-cli,codex-app/);
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
  assert.equal(existsSync(join(home, ".alfred", "runtime-profiles", "profiles")), true);
  assert.equal(existsSync(join(home, ".alfred", "runtime-profiles", "profiles.local")), true);
  assert.equal(existsSync(join(home, ".alfred", "observability", "install-trace.json")), true);
  const trace = JSON.parse(readFileSync(join(home, ".alfred", "observability", "install-trace.json"), "utf8"));
  assert.equal(trace.actor, "alfred-suite-install");
  assert.equal(trace.data.edition, "coding");
  assert.equal(trace.data.harnesses, "opencode,codex-cli");
  assert.match(trace.data.harness_status, /opencode=/);
  assert.equal(trace.data.provider_calls, 0);

  console.log("suite installer validation ok: preview is default, legacy flags fail closed, and apply does not install Pi by default");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
