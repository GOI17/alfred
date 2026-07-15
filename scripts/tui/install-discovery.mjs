#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

async function loadCanonicalModule(stagedName, sourceRelativePath) {
  const stagedPath = path.join(path.dirname(fileURLToPath(import.meta.url)), stagedName);
  const modulePath = fs.existsSync(stagedPath)
    ? stagedPath
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), sourceRelativePath);
  return import(pathToFileURL(modulePath).href);
}

const { detectMachineModels } = await loadCanonicalModule("profile-manager.mjs", "../../packages/profile-manager/src/index.js");
const { buildSmartModelDefaults, validateModelsConfig } = await loadCanonicalModule("model-assignment.mjs", "../../packages/core/src/model-assignment.js");

export const DISCOVERY_SCHEMA = "alfred.install.discovery/v1";
const HARNESS_IDS = ["opencode", "codex-cli", "codex-app", "pi"];

function executableOnPath(name, pathEnv = "", exists = fs.existsSync) {
  return pathEnv.split(path.delimiter).filter(Boolean).some((directory) => exists(path.join(directory, name)));
}

function gitResult(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return result.status === 0 ? result.stdout.trim() : null;
}

function normalizeGitPath(value, cwd) {
  if (!value) return null;
  return path.resolve(cwd, value);
}

function discoverGit({ cwd, gitAvailable, runGit = gitResult }) {
  if (!gitAvailable) {
    return {
      availability: "not-installed",
      workspace_root: "unknown",
      project_root: cwd,
      repository_state: "not-repository",
      linked_worktree_state: "not-applicable"
    };
  }
  const workspaceRoot = runGit(["rev-parse", "--show-toplevel"], cwd);
  if (!workspaceRoot) {
    return {
      availability: "installed",
      workspace_root: "unknown",
      project_root: cwd,
      repository_state: "not-repository",
      linked_worktree_state: "not-applicable"
    };
  }
  const gitDir = normalizeGitPath(runGit(["rev-parse", "--git-dir"], cwd), cwd);
  const commonDir = normalizeGitPath(runGit(["rev-parse", "--git-common-dir"], cwd), cwd);
  return {
    availability: "installed",
    workspace_root: path.resolve(workspaceRoot),
    project_root: commonDir && path.basename(commonDir) === ".git" ? path.dirname(commonDir) : path.resolve(workspaceRoot),
    repository_state: "repository",
    linked_worktree_state: gitDir && commonDir && gitDir !== commonDir ? "linked-worktree" : "main-worktree"
  };
}

function gitFromShellEnvironment(env) {
  if (!env.ALFRED_INSTALL_PROJECT_ROOT) return null;
  return {
    availability: env.ALFRED_INSTALL_GIT_AVAILABILITY || "unknown",
    source_workspace_path: path.resolve(env.ALFRED_INSTALL_SOURCE_WORKSPACE_PATH || process.cwd()),
    workspace_root: path.resolve(env.ALFRED_INSTALL_WORKSPACE_ROOT || env.ALFRED_INSTALL_SOURCE_WORKSPACE_PATH || process.cwd()),
    project_root: path.resolve(env.ALFRED_INSTALL_PROJECT_ROOT),
    repository_state: env.ALFRED_INSTALL_GIT_REPOSITORY_STATE || "unknown",
    linked_worktree_state: env.ALFRED_INSTALL_GIT_WORKTREE_STATE || "unknown"
  };
}

function harnessesFromLocalSignals({ cwd, homeDir, env, commandExists, directoryExists }) {
  return {
    opencode: directoryExists(path.join(cwd, ".opencode")) || commandExists("opencode") ? "installed" : "not-installed",
    "codex-cli": commandExists("codex") ? "installed" : "not-installed",
    "codex-app": directoryExists("/Applications/Codex.app") || directoryExists(path.join(homeDir, "Applications", "Codex.app")) || Boolean(env.CODEX_APP_HOME) ? "installed" : "not-installed",
    pi: commandExists("pi") || directoryExists(path.join(homeDir, ".pi")) ? "installed" : "not-installed"
  };
}

export function discoverInstallEnvironment(options = {}) {
  const env = options.env ?? process.env;
  const homeDir = path.resolve(options.homeDir ?? os.homedir());
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const exists = options.fileExists ?? fs.existsSync;
  const directoryExists = options.directoryExists ?? ((candidate) => {
    try { return fs.statSync(candidate).isDirectory(); } catch { return false; }
  });
  const commandExists = options.commandExists ?? ((name) => executableOnPath(name, env.PATH ?? "", exists));
  const requiredMajor = Number(options.requiredNodeMajor ?? 22);
  const nodeVersion = options.nodeVersion === undefined ? process.version : options.nodeVersion;
  const majorMatch = /^v?(\d+)/.exec(String(nodeVersion ?? ""));
  const nodeMajor = majorMatch ? Number(majorMatch[1]) : null;
  const targetPath = path.resolve(options.targetPath || env.ALFRED_INSTALL_TARGET_PATH || path.join(homeDir, ".alfred", "installs", env.ALFRED_INSTALL_NAME || "default"));
  const modelsPath = path.join(homeDir, ".alfred", "models.json");
  const models = detectMachineModels({
    env,
    homeDir,
    socketPaths: options.socketPaths,
    fileExists: exists
  });
  const proposed = buildSmartModelDefaults({ detectedModels: models.suggestions, targetPath: modelsPath });
  const validation = validateModelsConfig(proposed.config);
  const gitAvailable = options.gitAvailable ?? commandExists("git");
  const harnesses = options.harnesses ?? harnessesFromLocalSignals({ cwd, homeDir, env, commandExists, directoryExists });

  return {
    schema: DISCOVERY_SCHEMA,
    os: {
      platform: options.platform ?? process.platform,
      release: options.release ?? os.release(),
      architecture: options.architecture ?? process.arch
    },
    node: {
      status: nodeMajor === null ? "missing" : nodeMajor >= requiredMajor ? "ok" : "too-old",
      version: nodeMajor === null ? "unknown" : String(nodeVersion),
      major: nodeMajor ?? "unknown",
      required_major: requiredMajor
    },
    harnesses: Object.fromEntries(HARNESS_IDS.map((id) => [id, harnesses[id] === "installed" ? "installed" : "not-installed"])),
    models: {
      suggestions: models.suggestions,
      proposed_config: proposed.config,
      validation: { status: validation.status, errors: validation.errors },
      existing_config: exists(modelsPath)
    },
    install: {
      alfred_home: path.join(homeDir, ".alfred"),
      selected_target: targetPath,
      target_exists: exists(targetPath),
      models_config_path: modelsPath,
      models_config_exists: exists(modelsPath)
    },
    git: options.git ?? gitFromShellEnvironment(env) ?? discoverGit({ cwd, gitAvailable, runGit: options.runGit }),
    provider_calls: 0
  };
}

function fixtureOptions(filePath) {
  if (!filePath) return {};
  const fixture = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const existing = new Set(fixture.existing_paths ?? []);
  return {
    ...fixture,
    env: fixture.env ?? {},
    fileExists: (candidate) => existing.has(candidate),
    directoryExists: (candidate) => existing.has(candidate),
    commandExists: (name) => fixture.commands?.[name] === true,
    runGit: (args) => fixture.git_commands?.[args.join(" ")] ?? null
  };
}

function canonicalPath(value) {
  try { return fs.realpathSync(value); } catch { return path.resolve(value); }
}
const isMain = process.argv[1] && canonicalPath(process.argv[1]) === canonicalPath(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const fixture = fixtureOptions(process.env.ALFRED_INSTALL_DISCOVERY_FIXTURE_FILE);
    const report = discoverInstallEnvironment({
      ...fixture,
      targetPath: process.env.ALFRED_INSTALL_TARGET_PATH || fixture.targetPath,
      requiredNodeMajor: process.env.ALFRED_INSTALL_NODE_MIN || fixture.requiredNodeMajor
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Install discovery failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
