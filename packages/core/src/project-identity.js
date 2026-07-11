import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

function normalizeDirectory(value) {
  if (!value) return null;
  const resolved = path.resolve(value);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function readGitConfigValue(gitDir, key) {
  const configPath = path.join(gitDir, "config");
  if (!fs.existsSync(configPath)) return null;
  try {
    const text = fs.readFileSync(configPath, "utf8");
    const sectionMatch = key.match(/^(.+)\.([^ .]+)$/);
    if (!sectionMatch) return null;
    const section = sectionMatch[1];
    const name = sectionMatch[2];
    const sectionPattern = new RegExp(
      `^\\[${section.replace(/\./g, "\\.")}(?:\\s+"([^"]+)")?\\]\\s*$`,
      "m"
    );
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (sectionPattern.test(lines[i])) {
        for (let j = i + 1; j < lines.length && !/^\[/.test(lines[j]); j += 1) {
          const kv = lines[j].match(/^\s*(\S+)\s*=\s*(.*?)\s*$/);
          if (kv && kv[1] === name) {
            return kv[2];
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function runGit(args, cwd, { allowFailure = true } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    throw error;
  }
}

function readDotGitFile(root) {
  const dotGitPath = path.join(root, ".git");
  if (!fs.existsSync(dotGitPath) || fs.statSync(dotGitPath).isDirectory()) {
    return null;
  }

  try {
    const text = fs.readFileSync(dotGitPath, "utf8");
    const match = text.match(/^gitdir:\s*(.+)$/m);
    if (!match) return null;

    const gitdir = match[1].trim();
    return path.isAbsolute(gitdir) ? gitdir : path.resolve(root, gitdir);
  } catch {
    return null;
  }
}

function resolveCommonDir(gitDir) {
  if (!gitDir) return null;
  const commonDirPath = path.join(gitDir, "commondir");
  if (fs.existsSync(commonDirPath)) {
    try {
      const relativeCommon = fs.readFileSync(commonDirPath, "utf8").trim();
      return path.resolve(gitDir, relativeCommon);
    } catch {
      // fall through
    }
  }

  // If gitDir contains a .git directory, it is already the common dir.
  if (fs.existsSync(path.join(gitDir, "HEAD"))) {
    return gitDir;
  }

  return null;
}

function resolveMainWorktreePath(commonDir) {
  if (!commonDir) return null;

  const gitConfigWorktree = runGit(["config", "core.worktree"], commonDir);
  if (gitConfigWorktree) {
    return normalizeDirectory(gitConfigWorktree);
  }

  const configWorktree = readGitConfigValue(commonDir, "core.worktree");
  if (configWorktree) {
    return normalizeDirectory(configWorktree);
  }

  // Fallback: the main worktree is normally the parent of the common .git dir.
  const parent = path.dirname(commonDir);
  if (fs.existsSync(path.join(parent, ".git"))) {
    return normalizeDirectory(parent);
  }

  return null;
}

function resolveOriginUrl({ gitDir, commonDir }) {
  if (commonDir) {
    const remoteUrl = runGit(["remote", "get-url", "origin"], commonDir);
    if (remoteUrl) return remoteUrl;
  }

  if (gitDir) {
    const remoteUrl = runGit(["remote", "get-url", "origin"], gitDir);
    if (remoteUrl) return remoteUrl;
  }

  const configSource = commonDir ?? gitDir;
  if (configSource) {
    const configUrl = readGitConfigValue(configSource, "remote.origin.url");
    if (configUrl) return configUrl;
  }

  return null;
}

export function resolveProjectIdentity(root) {
  const workspaceRoot = normalizeDirectory(root);
  const dotGitPath = path.join(workspaceRoot, ".git");

  let gitDir = null;
  let commonDir = null;
  let isWorktree = false;
  let originUrl = null;

  if (!fs.existsSync(dotGitPath)) {
    // Bare repositories have no `.git` subdir; the root is the git directory.
    const bareGitDir =
      fs.existsSync(path.join(workspaceRoot, "HEAD")) && fs.existsSync(path.join(workspaceRoot, "config"))
        ? workspaceRoot
        : null;

    return {
      workspace_root: workspaceRoot,
      project_root: workspaceRoot,
      is_worktree: false,
      origin_url: bareGitDir ? resolveOriginUrl({ gitDir: bareGitDir, commonDir: bareGitDir }) : null,
      git_dir: bareGitDir
    };
  }

  if (fs.statSync(dotGitPath).isDirectory()) {
    gitDir = fs.realpathSync(dotGitPath);
    commonDir = resolveCommonDir(gitDir);
    isWorktree = fs.existsSync(path.join(gitDir, "commondir"));
  } else {
    gitDir = readDotGitFile(workspaceRoot);
    commonDir = resolveCommonDir(gitDir);
    isWorktree = true;
  }

  const projectRoot = isWorktree ? resolveMainWorktreePath(commonDir) : workspaceRoot;
  originUrl = resolveOriginUrl({ gitDir, commonDir });

  return {
    workspace_root: workspaceRoot,
    project_root: projectRoot ?? workspaceRoot,
    is_worktree: isWorktree,
    origin_url: originUrl,
    git_dir: gitDir
  };
}
