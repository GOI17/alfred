import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROFILE_DIR = "profiles";
const PROFILE_LOCAL_DIR = "profiles.local";
const DEFAULT_SKIPPED_DIRS = new Set([".cache", ".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "tmp"]);
const DEFAULT_SKIPPED_FILES = new Set(["bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const PROFILE_COPY_SKIP_FILES = new Set(["bun.lock", "bun.lockb", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const PROFILE_COPY_SKIP_DIRS = new Set([".cache", ".git", ".next", ".turbo", "build", "coverage", "dist", "node_modules", "tmp"]);

function assertSimpleName(kind, value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${kind} cannot be empty`);
  if (path.isAbsolute(value) || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new Error(`${kind} must be a simple directory name: ${value}`);
  }
  return value;
}

export function validateProfileName(value) {
  return assertSimpleName("Profile name", value);
}

export function validateAgentName(value) {
  return assertSimpleName("Agent name", value);
}

export function validateRelativePath(value) {
  if (typeof value !== "string" || value.trim() === "") throw new Error("Path cannot be empty");
  if (path.isAbsolute(value) || value.includes("..")) throw new Error(`Path must be relative and cannot contain '..': ${value}`);
  return value;
}

export function stripJsonc(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1] ?? "";
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === "/" && next === "/") {
      index += 1;
      while (index + 1 < text.length && !"\r\n".includes(text[index + 1])) index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index + 1 < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        if ("\r\n".includes(text[index])) output += text[index];
        index += 1;
      }
      continue;
    }
    output += char;
  }
  return output;
}

export function removeTrailingCommas(text) {
  let output = "";
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }
    if (char === ",") {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead += 1;
      if (lookahead < text.length && ["}", "]"].includes(text[lookahead])) continue;
    }
    output += char;
  }
  return output;
}

export function parseJsonc(text) {
  const cleaned = removeTrailingCommas(stripJsonc(text)).trim();
  if (!cleaned) return {};
  const value = JSON.parse(cleaned);
  if (value === null || Array.isArray(value) || typeof value !== "object") throw new TypeError("JSONC profile config must be an object");
  return value;
}

export function readJsonc(filePath) {
  return parseJsonc(fs.readFileSync(filePath, "utf8"));
}

export function deepMerge(primary, overlay) {
  const result = { ...primary };
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const primaryValue = result[key];
    if (
      primaryValue &&
      overlayValue &&
      typeof primaryValue === "object" &&
      typeof overlayValue === "object" &&
      !Array.isArray(primaryValue) &&
      !Array.isArray(overlayValue)
    ) {
      result[key] = deepMerge(primaryValue, overlayValue);
    } else {
      result[key] = overlayValue;
    }
  }
  return result;
}

export function mergeJsoncFiles({ primaryPath, overlayPath }) {
  const primary = fs.existsSync(primaryPath) ? readJsonc(primaryPath) : {};
  const overlay = overlayPath && fs.existsSync(overlayPath) ? readJsonc(overlayPath) : {};
  return deepMerge(primary, overlay);
}

export function profileRepoPaths({ repoPath, profile, agent, homeDir = os.homedir() }) {
  const resolvedRepoPath = path.resolve(repoPath);
  const safeProfile = validateProfileName(profile);
  const safeAgent = validateAgentName(agent);
  return {
    repoPath: resolvedRepoPath,
    profile: safeProfile,
    agent: safeAgent,
    trackedProfileDir: path.join(resolvedRepoPath, PROFILE_DIR, safeProfile, safeAgent),
    localProfileDir: path.join(resolvedRepoPath, PROFILE_LOCAL_DIR, safeProfile, safeAgent),
    globalConfigDir: path.join(homeDir, ".config", safeAgent),
    tracePath: path.join(resolvedRepoPath, ".alfred", "observability", "profile-manager-trace.json")
  };
}

export function initProfileRepository({ repoPath, initializeGit = false }) {
  const resolvedRepoPath = path.resolve(repoPath);
  fs.mkdirSync(path.join(resolvedRepoPath, PROFILE_DIR), { recursive: true });
  fs.mkdirSync(path.join(resolvedRepoPath, PROFILE_LOCAL_DIR), { recursive: true });
  const gitignorePath = path.join(resolvedRepoPath, ".gitignore");
  if (!fs.existsSync(gitignorePath)) fs.writeFileSync(gitignorePath, `${PROFILE_LOCAL_DIR}/\n.DS_Store\n`);
  const readmePath = path.join(resolvedRepoPath, "README.md");
  if (!fs.existsSync(readmePath)) {
    fs.writeFileSync(
      readmePath,
      "# Alfred Runtime Profiles\n\nShared profile defaults live in `profiles/`; private machine overlays live in `profiles.local/`.\n"
    );
  }
  let gitInitialized = fs.existsSync(path.join(resolvedRepoPath, ".git"));
  if (initializeGit && !gitInitialized) {
    const result = spawnSync("git", ["init"], { cwd: resolvedRepoPath, stdio: "ignore" });
    gitInitialized = result.status === 0;
  }
  return {
    status: "pass",
    repo_path: resolvedRepoPath,
    created_paths: [PROFILE_DIR, PROFILE_LOCAL_DIR, ".gitignore", "README.md"],
    git_initialized: gitInitialized,
    provider_calls: 0
  };
}

function shouldSkipPath(relativePath, { skippedDirs = DEFAULT_SKIPPED_DIRS, skippedFiles = DEFAULT_SKIPPED_FILES } = {}) {
  const parts = relativePath.split(path.sep);
  return parts.some((part) => skippedDirs.has(part) || part.startsWith(".env")) || skippedFiles.has(parts.at(-1));
}

function isJsonCandidate(filePath) {
  return filePath.endsWith(".json") || filePath.endsWith(".jsonc");
}

function walkFiles(root) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    const relativePath = path.relative(root, entryPath);
    if (shouldSkipPath(relativePath)) continue;
    if (entry.isDirectory()) files.push(...walkFiles(entryPath));
    else if (entry.isFile() && isJsonCandidate(entryPath)) files.push(entryPath);
  }
  return files;
}

function entropy(value) {
  if (value.length < 24) return 0;
  const counts = new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  return [...counts.values()].reduce((total, count) => total - (count / value.length) * Math.log2(count / value.length), 0);
}

function isPathLikeKey(key) {
  return String(key).includes("/") || String(key).includes("*") || String(key).includes("~");
}

function isSensitiveKey(key) {
  const lower = String(key).toLowerCase();
  const matches = /(^|[._-])(key|apikey|token|secret|password|authorization|credential|headers)$/.test(lower);
  return matches && (!isPathLikeKey(key) || lower === "authorization");
}

function isPlaceholder(value) {
  return /^Bearer\s+\$\{[A-Z0-9_]+\}$/.test(value) || /^\$\{[A-Z0-9_]+\}$/.test(value);
}

function subtreeHasPlaceholder(value) {
  if (typeof value === "string") return isPlaceholder(value);
  if (Array.isArray(value)) return value.some(subtreeHasPlaceholder);
  if (value && typeof value === "object") return Object.values(value).some(subtreeHasPlaceholder);
  return false;
}

function sensitivePath(pathParts) {
  return pathParts.some((part) => isSensitiveKey(part));
}

function suspiciousValue(value, pathParts) {
  if (typeof value !== "string" || isPlaceholder(value)) return false;
  if (/Bearer\s+[A-Za-z0-9._~+/=-]{12,}/.test(value) || /sk-[A-Za-z0-9]{16,}/.test(value) || /ghp_[A-Za-z0-9]{20,}/.test(value)) {
    return true;
  }
  return sensitivePath(pathParts) && value.length >= 32 && entropy(value) >= 4;
}

function collectSecretCandidates(value, pathParts = []) {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((child, index) => findings.push(...collectSecretCandidates(child, [...pathParts, String(index)])));
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = [...pathParts, key];
      if (isSensitiveKey(key) && key.toLowerCase() !== "headers" && !subtreeHasPlaceholder(child)) findings.push(childPath.join("/"));
      findings.push(...collectSecretCandidates(child, childPath));
    }
    return findings;
  }
  if (suspiciousValue(value, pathParts)) findings.push(pathParts.join("/") || "value");
  return findings;
}

export function scanSecretCandidates({ sourceDir }) {
  const findings = [];
  const parseErrors = [];
  for (const filePath of walkFiles(sourceDir)) {
    try {
      const parsed = readJsonc(filePath);
      for (const finding of collectSecretCandidates(parsed)) {
        findings.push({ path: path.relative(sourceDir, filePath), pointer: finding });
      }
    } catch (error) {
      parseErrors.push({ path: path.relative(sourceDir, filePath), error: error.constructor.name });
    }
  }
  const uniqueFindings = [...new Map(findings.map((finding) => [`${finding.path}::${finding.pointer}`, finding])).values()];
  return {
    status: parseErrors.length === 0 && uniqueFindings.length === 0 ? "pass" : "fail",
    source_dir: sourceDir,
    findings: uniqueFindings,
    parse_errors: parseErrors,
    provider_calls: 0
  };
}

function copyProfileTree(sourceDir, destDir) {
  if (!fs.existsSync(sourceDir)) return;
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const relativePath = path.relative(sourceDir, sourcePath);
    const parts = relativePath.split(path.sep);
    if (parts.some((part) => PROFILE_COPY_SKIP_DIRS.has(part)) || PROFILE_COPY_SKIP_FILES.has(entry.name)) continue;
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyProfileTree(sourcePath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(sourcePath, destPath);
    }
  }
}

function mergeOpencodeProfileFiles(trackedProfileDir, localProfileDir) {
  for (const fileName of ["opencode.json", "opencode.jsonc"]) {
    const trackedPath = path.join(trackedProfileDir, fileName);
    const localPath = path.join(localProfileDir, fileName);
    if (fs.existsSync(trackedPath) && fs.existsSync(localPath)) {
      const merged = mergeJsoncFiles({ primaryPath: trackedPath, overlayPath: localPath });
      fs.writeFileSync(localPath, `${JSON.stringify(merged, null, 2)}\n`);
    }
  }
}

export function materializeLocalProfile({ repoPath, profile, agent }) {
  const paths = profileRepoPaths({ repoPath, profile, agent });
  if (!fs.existsSync(paths.trackedProfileDir) && !fs.existsSync(paths.localProfileDir)) {
    throw new Error(`Missing profile source: ${profile}/${agent}`);
  }
  const trackedScan = fs.existsSync(paths.trackedProfileDir)
    ? scanSecretCandidates({ sourceDir: paths.trackedProfileDir })
    : { status: "pass", findings: [], parse_errors: [] };
  if (trackedScan.status !== "pass") {
    throw new Error(`Secret candidates found in tracked profile: ${trackedScan.findings.map((finding) => `${finding.path}::${finding.pointer}`).join(", ")}`);
  }
  fs.mkdirSync(paths.localProfileDir, { recursive: true });
  if (fs.existsSync(paths.trackedProfileDir)) copyProfileTree(paths.trackedProfileDir, paths.localProfileDir);
  mergeOpencodeProfileFiles(paths.trackedProfileDir, paths.localProfileDir);
  return {
    status: "pass",
    profile,
    agent,
    tracked_profile_dir: paths.trackedProfileDir,
    local_profile_dir: paths.localProfileDir,
    provider_calls: 0
  };
}

export function detectMachineCapabilities({ pathEnv = process.env.PATH ?? "", providers = {}, models = {}, plugins = {}, required = {} } = {}) {
  const pathEntries = pathEnv.split(path.delimiter).filter(Boolean);
  const executableCandidates = required.executables ?? [];
  const executableResults = Object.fromEntries(
    executableCandidates.map((executable) => [
      executable,
      pathEntries.some((entry) => fs.existsSync(path.join(entry, executable)))
    ])
  );
  const providerResults = Object.fromEntries((required.providers ?? []).map((provider) => [provider, providers[provider] === true]));
  const modelResults = Object.fromEntries((required.models ?? []).map((model) => [model, models[model] === true]));
  const pluginResults = Object.fromEntries((required.plugins ?? []).map((plugin) => [plugin, plugins[plugin] === true]));
  return {
    status: "pass",
    path_entries: pathEntries.length,
    executables: executableResults,
    providers: providerResults,
    models: modelResults,
    plugins: pluginResults,
    missing: {
      executables: Object.entries(executableResults).filter(([, ok]) => !ok).map(([name]) => name),
      providers: Object.entries(providerResults).filter(([, ok]) => !ok).map(([name]) => name),
      models: Object.entries(modelResults).filter(([, ok]) => !ok).map(([name]) => name),
      plugins: Object.entries(pluginResults).filter(([, ok]) => !ok).map(([name]) => name)
    },
    provider_calls: 0
  };
}

function firstEnv(env, names) {
  return names.find((name) => typeof env[name] === "string" && env[name].trim() !== "") ?? null;
}

function socketExists(filePath, fileExists) {
  try {
    return fileExists(filePath);
  } catch {
    return false;
  }
}

export function detectMachineModels({
  env = process.env,
  homeDir = os.homedir(),
  socketPaths = ["/var/run/ollama.sock", "/tmp/ollama.sock", path.join(homeDir, ".ollama", "ollama.sock")],
  fileExists = fs.existsSync
} = {}) {
  const suggestions = [];
  const add = (provider, model, source) => suggestions.push({ provider, model, source });

  if (env.OLLAMA_HOST && env.OLLAMA_HOST.trim() !== "") {
    add("ollama", "ollama/qwen2.5-coder:7b", "env:OLLAMA_HOST");
  } else {
    const ollamaSocket = socketPaths.find((socketPath) => socketExists(socketPath, fileExists));
    if (ollamaSocket) add("ollama", "ollama/qwen2.5-coder:7b", `socket:${ollamaSocket}`);
  }

  const openaiEnv = firstEnv(env, ["OPENAI_API_KEY"]);
  if (openaiEnv) add("openai", "openai/gpt-4.1-mini", `env:${openaiEnv}`);

  const copilotEnv = firstEnv(env, ["GITHUB_COPILOT_TOKEN", "COPILOT_TOKEN"]);
  if (copilotEnv) add("copilot", "copilot/gpt-4.1", `env:${copilotEnv}`);

  const anthropicEnv = firstEnv(env, ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"]);
  if (anthropicEnv) add("anthropic", "anthropic/claude-sonnet-4", `env:${anthropicEnv}`);

  const geminiEnv = firstEnv(env, ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]);
  if (geminiEnv) add("gemini", "gemini/gemini-2.5-flash", `env:${geminiEnv}`);

  return {
    status: "pass",
    suggestions,
    provider_calls: 0
  };
}

export function buildProfileActivationPlan({ repoPath, profile, agent, homeDir = os.homedir(), required = {}, capabilities = {} }) {
  const paths = profileRepoPaths({ repoPath, profile, agent, homeDir });
  const machine = detectMachineCapabilities({ ...capabilities, required });
  const trackedExists = fs.existsSync(paths.trackedProfileDir);
  const localExists = fs.existsSync(paths.localProfileDir);
  const globalExists = fs.existsSync(paths.globalConfigDir) || fs.existsSync(paths.globalConfigDir);
  const globalIsSymlink = fs.existsSync(paths.globalConfigDir) && fs.lstatSync(paths.globalConfigDir).isSymbolicLink();
  const blockers = [];
  if (!trackedExists && !localExists) blockers.push("missing_profile_source");
  if (globalExists && !globalIsSymlink) blockers.push("existing_machine_config_requires_reconciliation");
  return {
    status: blockers.length === 0 ? "pass" : "needs_approval",
    operation: "profile_activation_plan",
    profile,
    agent,
    paths: {
      repo: paths.repoPath,
      tracked_profile: paths.trackedProfileDir,
      local_profile: paths.localProfileDir,
      target_config: paths.globalConfigDir
    },
    machine,
    actions: [
      trackedExists ? "scan_tracked_profile_for_secrets" : "use_existing_local_profile",
      trackedExists ? "materialize_tracked_defaults_into_profiles.local" : "skip_materialization",
      "activate_profile_symlink"
    ],
    blockers,
    writes_harness_config_by_default: false,
    human_approval_required_before_write: blockers.includes("existing_machine_config_requires_reconciliation"),
    provider_calls: 0
  };
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, filePath);
}

export function createProfileTrace({ operation, status, profile, agent, targetPath, humanApproval = false }) {
  return {
    trace_id: "profile-manager-operation",
    timestamp: new Date(0).toISOString(),
    event: "profile_manager_operation",
    actor: "alfred-profile-manager",
    data: {
      operation,
      profile,
      agent,
      target_path: targetPath,
      status,
      human_approval: humanApproval,
      provider_calls: 0
    }
  };
}

export function activateProfile({ repoPath, profile, agent, homeDir = os.homedir(), dryRun = false, force = false, trace = true } = {}) {
  const plan = buildProfileActivationPlan({ repoPath, profile, agent, homeDir });
  const paths = profileRepoPaths({ repoPath, profile, agent, homeDir });
  if (dryRun) return { ...plan, dry_run: true, applied: false };
  if (plan.blockers.includes("missing_profile_source")) throw new Error(`Missing profile source: ${profile}/${agent}`);
  if (plan.blockers.includes("existing_machine_config_requires_reconciliation") && !force) {
    throw new Error(`Refusing to replace existing machine config: ${paths.globalConfigDir}`);
  }
  materializeLocalProfile({ repoPath, profile, agent });
  fs.mkdirSync(path.dirname(paths.globalConfigDir), { recursive: true });
  if (fs.existsSync(paths.globalConfigDir)) {
    if (fs.lstatSync(paths.globalConfigDir).isSymbolicLink()) fs.unlinkSync(paths.globalConfigDir);
    else if (force) fs.rmSync(paths.globalConfigDir, { recursive: true, force: true });
  }
  fs.symlinkSync(paths.localProfileDir, paths.globalConfigDir, "dir");
  const event = createProfileTrace({ operation: "switch", status: "pass", profile, agent, targetPath: paths.globalConfigDir, humanApproval: force });
  if (trace) writeJsonAtomic(paths.tracePath, event);
  return {
    ...plan,
    status: "pass",
    applied: true,
    symlink: { path: paths.globalConfigDir, target: paths.localProfileDir },
    trace: trace ? paths.tracePath : null,
    provider_calls: 0
  };
}

export function doctorProfileManager({ repoPath, profile, agent, homeDir = os.homedir() }) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, ok, detail });
  add("repo_exists", fs.existsSync(repoPath), repoPath);
  add("profiles_dir_exists", fs.existsSync(path.join(repoPath, PROFILE_DIR)), path.join(repoPath, PROFILE_DIR));
  add("profiles_local_dir_exists", fs.existsSync(path.join(repoPath, PROFILE_LOCAL_DIR)), path.join(repoPath, PROFILE_LOCAL_DIR));
  if (profile && agent) {
    const paths = profileRepoPaths({ repoPath, profile, agent, homeDir });
    add("profile_source_exists", fs.existsSync(paths.trackedProfileDir) || fs.existsSync(paths.localProfileDir), `${profile}/${agent}`);
    const plan = buildProfileActivationPlan({ repoPath, profile, agent, homeDir });
    add("activation_plan_builds", plan.status === "pass" || plan.status === "needs_approval", plan.status);
  }
  return {
    status: checks.every((check) => check.ok) ? "pass" : "fail",
    checks,
    provider_calls: 0
  };
}

export function buildProfileManagerComponent() {
  return {
    id: "profile-manager",
    package: "packages/profile-manager",
    source_repo: "https://github.com/GOI17/agents",
    purpose: "Manage reusable agent runtime profiles across machines, harnesses, PATH differences, providers, models, and plugins.",
    owns: ["profiles/", "profiles.local/", "~/.config/<agent> activation symlink"],
    requires_configuration: true,
    configuration: ["profile repository path", "profile name", "agent/harness name", "machine-local provider/model/plugin overlay"],
    protected_writes: ["~/.config/<agent>"],
    provider_calls_allowed: 0
  };
}
