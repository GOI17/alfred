import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { digestFiles, fail, safeRelative } from "./model.js";

export const MAX_FILES = 1000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TREE_BYTES = 25 * 1024 * 1024;
export const CONTROL_DIRS = new Set([".git", ".hg", ".svn"]);

export function statOrNull(target) {
  try { return fs.lstatSync(target); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

export function canonicalRoot(value) {
  const absolute = path.resolve(value);
  const existing = statOrNull(absolute);
  if (existing) {
    if (!fs.statSync(absolute).isDirectory()) fail("E_UNSAFE_PATH", `Expected a directory: ${absolute}`);
    return fs.realpathSync(absolute);
  }
  // Home/config roots may not exist in a clean environment. Canonicalize the
  // existing ancestor (e.g. macOS /var) without following links below it later.
  const parent = path.dirname(absolute);
  if (parent === absolute) fail("E_UNSAFE_PATH", "Cannot resolve filesystem root.");
  return path.join(canonicalRoot(parent), path.basename(absolute));
}

export function assertSafePath(base, target, { regularFile = false } = {}) {
  const relative = path.relative(base, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail("E_UNSAFE_PATH", "Path escapes its selected root.");
  let current = base;
  const pieces = relative ? relative.split(path.sep) : [];
  for (let index = -1; index < pieces.length; index++) {
    if (index >= 0) current = path.join(current, pieces[index]);
    const stat = statOrNull(current);
    if (!stat) continue;
    if (stat.isSymbolicLink()) fail("E_UNSAFE_PATH", `Symbolic links are not supported in managed paths: ${current}`);
    const isLast = index === pieces.length - 1;
    if (!isLast && !stat.isDirectory()) fail("E_UNSAFE_PATH", `Ancestor is not a directory: ${current}`);
    if (isLast && regularFile && (!stat.isFile() || stat.nlink !== 1)) fail("E_UNSAFE_PATH", `State must be a regular, unlinked file: ${current}`);
  }
}

export function safeReadFile(target, limit = MAX_FILE_BYTES) {
  let descriptor;
  try {
    const before = fs.lstatSync(target);
    if (!before.isFile() || before.nlink !== 1) fail("E_UNSAFE_PATH", `Expected a regular file without links: ${target}`);
    descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink !== 1) fail("E_UNSAFE_PATH", `Expected a regular file without hardlinks: ${target}`);
    if (stat.size > limit) fail("E_LIMIT", `File exceeds ${limit} bytes: ${target}`);
    // Read at most the limit even if another process grows the file mid-read.
    const buffer = Buffer.alloc(Math.min(stat.size + 1, limit + 1));
    let count = 0;
    while (count < buffer.length) {
      const read = fs.readSync(descriptor, buffer, count, buffer.length - count, null);
      if (!read) break;
      count += read;
    }
    const after = fs.fstatSync(descriptor);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || count !== stat.size) fail("E_SOURCE_CHANGED", `File changed while reading: ${target}`);
    return { bytes: buffer.subarray(0, count), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error.code === "ELOOP") fail("E_UNSAFE_PATH", `Symbolic link is not allowed: ${target}`);
    throw error;
  } finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
}

export function readTree(root, { excludeControlDirectories = false } = {}) {
  const initial = statOrNull(root);
  if (!initial) fail("E_SOURCE_NOT_FOUND", `Skill directory does not exist: ${root}`);
  if (!initial.isDirectory() || initial.isSymbolicLink()) fail("E_UNSAFE_PATH", `Skill root must be a directory without symlinks: ${root}`);
  const files = [];
  let bytes = 0;
  let entries = 0;
  function visit(relative = "", depth = 0) {
    if (depth > 30) fail("E_LIMIT", "Skill directory nesting exceeds 30 levels.");
    const directory = path.join(root, relative);
    assertSafePath(root, directory);
    for (const name of fs.readdirSync(directory).sort()) {
      if (excludeControlDirectories && CONTROL_DIRS.has(name)) continue;
      if (++entries > MAX_FILES * 2) fail("E_LIMIT", "Skill contains too many filesystem entries.");
      const child = relative ? `${relative}/${name}` : name;
      safeRelative(child);
      const full = path.join(root, child);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) fail("E_UNSAFE_PATH", `Skill contains a symbolic link: ${child}`);
      if (stat.isDirectory()) visit(child, depth + 1);
      else {
        const file = safeReadFile(full);
        bytes += file.bytes.length;
        if (files.length >= MAX_FILES || bytes > MAX_TREE_BYTES) fail("E_LIMIT", "Skill exceeds the file count or total byte limit.");
        files.push({ path: child, ...file });
      }
    }
  }
  visit();
  return { files, digest: digestFiles(files) };
}

export function atomicWrite(base, target, bytes) {
  assertSafePath(base, target, { regularFile: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  assertSafePath(base, target, { regularFile: true });
  const temporary = path.join(path.dirname(target), `.alfred-${randomUUID()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "wx", 0o600);
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    assertSafePath(base, target, { regularFile: true });
    fs.renameSync(temporary, target);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (statOrNull(temporary)) fs.unlinkSync(temporary);
  }
}

export function stageTree(root, files) {
  fs.mkdirSync(root, { mode: 0o700 });
  for (const file of files) {
    safeRelative(file.path);
    const target = path.join(root, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, file.bytes, { flag: "wx", mode: file.mode });
    fs.chmodSync(target, file.mode);
  }
  fs.chmodSync(root, 0o755);
}
