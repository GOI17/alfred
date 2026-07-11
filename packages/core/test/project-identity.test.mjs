import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

import { resolveProjectIdentity } from "../src/index.js";

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function writeGitConfig(root, values) {
  const configPath = path.join(root, ".git", "config");
  let text = "";
  for (const [section, entries] of Object.entries(values)) {
    text += `[${section}]\n`;
    for (const [key, value] of Object.entries(entries)) {
      text += `\t${key} = ${value}\n`;
    }
  }
  fs.writeFileSync(configPath, text);
}

function withDir(fn) {
  const root = tmp("alfred-project-identity-");
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createBareRepo() {
  const root = tmp("alfred-bare-repo-");
  git(["init", "--bare", "repo.git"], root);
  return { root, repo: path.join(root, "repo.git") };
}

test("normal git repo resolves workspace as project root", () => {
  withDir((root) => {
    git(["init"], root);
    fs.writeFileSync(path.join(root, "file.txt"), "hello");
    git(["add", "file.txt"], root);
    git(["commit", "-m", "init"], root);

    const identity = resolveProjectIdentity(root);

    assert.equal(identity.workspace_root, fs.realpathSync(root));
    assert.equal(identity.project_root, fs.realpathSync(root));
    assert.equal(identity.is_worktree, false);
    assert.ok(identity.git_dir.startsWith(fs.realpathSync(root)));
    assert.match(identity.git_dir, /\.git$/);
  });
});

test("git worktree resolves project root to main worktree", () => {
  withDir((main) => {
    git(["init"], main);
    fs.writeFileSync(path.join(main, "README.md"), "main");
    git(["add", "README.md"], main);
    git(["commit", "-m", "init"], main);

    const worktree = tmp("alfred-worktree-fix-");
    git(["worktree", "add", worktree], main);

    const identity = resolveProjectIdentity(worktree);

    assert.equal(identity.workspace_root, fs.realpathSync(worktree));
    assert.equal(identity.project_root, fs.realpathSync(main));
    assert.equal(identity.is_worktree, true);
    assert.ok(identity.git_dir);
    assert.equal(identity.origin_url, null);
  });
});

test("repo without git is its own project root", () => {
  withDir((root) => {
    fs.writeFileSync(path.join(root, "untracked.txt"), "ok");

    const identity = resolveProjectIdentity(root);

    assert.equal(identity.workspace_root, fs.realpathSync(root));
    assert.equal(identity.project_root, fs.realpathSync(root));
    assert.equal(identity.is_worktree, false);
    assert.equal(identity.origin_url, null);
    assert.equal(identity.git_dir, null);
  });
});

test("bare repo reports itself as project root with no worktree", () => {
  const { repo } = createBareRepo();

  const identity = resolveProjectIdentity(repo);

  assert.equal(identity.workspace_root, fs.realpathSync(repo));
  assert.equal(identity.project_root, fs.realpathSync(repo));
  assert.equal(identity.is_worktree, false);
  assert.equal(identity.git_dir, fs.realpathSync(repo));
});

test("origin url is read from remote or .git/config fallback", () => {
  withDir((root) => {
    git(["init"], root);
    fs.writeFileSync(path.join(root, "file.txt"), "hello");
    git(["add", "file.txt"], root);
    git(["commit", "-m", "init"], root);
    git(["remote", "add", "origin", "https://example.com/repo.git"], root);

    const identity = resolveProjectIdentity(root);

    assert.equal(identity.origin_url, "https://example.com/repo.git");
  });
});

test("missing git binary returns non-worktree identity", () => {
  withDir((root) => {
    git(["init"], root);
    fs.writeFileSync(path.join(root, "file.txt"), "hello");

    const backupPath = process.env.PATH;
    try {
      process.env.PATH = "/dev/null";
      const identity = resolveProjectIdentity(root);
      assert.equal(identity.workspace_root, fs.realpathSync(root));
      assert.equal(identity.project_root, fs.realpathSync(root));
      assert.equal(identity.is_worktree, false);
      assert.equal(identity.origin_url, null);
      assert.ok(identity.git_dir);
    } finally {
      process.env.PATH = backupPath;
    }
  });
});
