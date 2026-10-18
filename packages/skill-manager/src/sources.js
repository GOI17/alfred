import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { CONTROL_DIRS, MAX_FILE_BYTES, MAX_FILES, MAX_TREE_BYTES, readTree, statOrNull } from "./filesystem.js";
import { digestFiles, fail, safeRelative, skillMetadata, validName } from "./model.js";

function repositoryUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail("E_SOURCE", "Use a local skill directory or https://github.com/owner/repository with --skill."); }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) {
    fail("E_SOURCE", "Only public GitHub repository HTTPS URLs without credentials, queries or fragments are supported.");
  }
  const repository = url.pathname.replace(/\/$/, "").replace(/\.git$/, "");
  if (!/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || repository.split("/").some((part) => part === "." || part === "..")) {
    fail("E_SOURCE", "Pass https://github.com/owner/repository and select its directory with --skill.");
  }
  return { repository: `https://github.com${repository}`, api: `https://api.github.com/repos${repository}` };
}

async function githubJson(url, fetcher, maximum = MAX_TREE_BYTES * 2) {
  let response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "alfred-skill-manager" },
      redirect: "error",
      signal: AbortSignal.timeout(20_000)
    });
  } catch { fail("E_NETWORK", "GitHub source acquisition failed. Check connectivity and retry; no credentials were searched or sent."); }
  if (!response.ok) fail("E_SOURCE", `GitHub returned HTTP ${response.status}. Check the public repository/ref and API rate limit; private repositories require a local source directory.`);
  const reader = response.body?.getReader();
  if (!reader) fail("E_SOURCE", "GitHub returned an empty response.");
  const parts = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); fail("E_LIMIT", "GitHub response exceeds the size limit."); }
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { fail("E_SOURCE", "GitHub returned invalid JSON."); }
}

async function readBlob(entry, { api, fetcher, cache }) {
  if (cache.has(entry.sha)) {
    const cached = cache.get(entry.sha);
    if (cached.length !== entry.size) fail("E_SOURCE", "GitHub tree contains inconsistent blob sizes.");
    return cached;
  }
  const blob = await githubJson(`${api}/git/blobs/${entry.sha}`, fetcher, MAX_FILE_BYTES * 2);
  if (blob.encoding !== "base64" || typeof blob.content !== "string") fail("E_SOURCE", "GitHub blob must contain base64 encoded content.");
  const compact = blob.content.replace(/\s/g, "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(compact)) fail("E_SOURCE", "GitHub blob contains invalid base64.");
  const bytes = Buffer.from(compact, "base64");
  const gitHash = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
  if (bytes.length !== entry.size || gitHash !== entry.sha) fail("E_SOURCE", "GitHub blob does not match the pinned tree content.");
  cache.set(entry.sha, bytes);
  return bytes;
}

async function directoryByName(tree, name, transport) {
  const candidates = tree.filter((entry) => (entry.path === "SKILL.md" || entry.path.endsWith("/SKILL.md")) &&
    !entry.path.split("/").some((part) => CONTROL_DIRS.has(part)));
  if (candidates.length > 100) fail("E_LIMIT", "Name discovery exceeds 100 SKILL.md candidates; select a known directory with --skill instead.");
  let size = 0;
  for (const entry of candidates) {
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) fail("E_UNSAFE_PATH", "Name discovery encountered a linked or unsupported SKILL.md; use a verified --skill directory.");
    if (!/^[a-f0-9]{40}$/.test(entry.sha ?? "") || !Number.isSafeInteger(entry.size) || entry.size < 0) fail("E_SOURCE", "Invalid SKILL.md blob metadata during name discovery.");
    size += entry.size;
    if (entry.size > 64 * 1024 || size > 1024 * 1024) fail("E_LIMIT", "Name discovery exceeds its metadata byte limit; select a known directory with --skill instead.");
  }
  const matches = [];
  for (const entry of candidates) {
    const bytes = await readBlob(entry, transport);
    let metadata;
    try { metadata = skillMetadata([{ path: "SKILL.md", bytes, mode: entry.mode === "100755" ? 0o755 : 0o644 }]); }
    catch (error) { if (["E_INVALID_SKILL", "E_INVALID_NAME"].includes(error.code)) continue; throw error; }
    if (metadata.name === name) matches.push(entry.path === "SKILL.md" ? "" : entry.path.slice(0, -9));
  }
  if (!matches.length) fail("E_NOT_FOUND", `No valid SKILL.md declares name ${name} at this commit. Select a verified --skill directory.`);
  if (matches.length > 1) fail("E_AMBIGUOUS", `Multiple packages declare ${name}: ${matches.map((match) => match || ".").join(", ")}. Select one directory with --skill.`);
  return matches[0];
}

async function githubSnapshot(source, { skill, name, ref, fetcher }) {
  const { repository, api } = repositoryUrl(source);
  if (skill !== undefined && name !== undefined) fail("E_ARGUMENT", "--name and --skill are mutually exclusive selectors.");
  if (skill === undefined && name === undefined) fail("E_ARGUMENT", "GitHub installation requires --skill <directory> or --name <declared-skill-name>.");
  if (name !== undefined) validName(name);
  let skillPath = skill !== undefined ? safeRelative(skill, { allowRoot: true }) : null;
  const requestedRef = ref ?? "HEAD";
  if (typeof requestedRef !== "string" || !requestedRef || requestedRef.length > 256 || /[\x00-\x20\x7f]/.test(requestedRef)) fail("E_ARGUMENT", "GitHub ref must be a nonempty branch, tag, or commit without whitespace.");
  const commit = await githubJson(`${api}/commits/${encodeURIComponent(requestedRef)}`, fetcher);
  const resolvedCommit = commit.sha;
  if (!/^[a-f0-9]{40}$/.test(resolvedCommit ?? "")) fail("E_SOURCE", "GitHub did not resolve an immutable full commit.");
  if (/^[a-f0-9]{40}$/.test(requestedRef) && requestedRef !== resolvedCommit) fail("E_SOURCE", "GitHub resolved a different commit from the explicitly pinned revision.");
  const treeSha = commit.commit?.tree?.sha ?? resolvedCommit;
  if (!/^[a-f0-9]{40}$/.test(treeSha)) fail("E_SOURCE", "GitHub returned an invalid tree identity.");
  const tree = await githubJson(`${api}/git/trees/${treeSha}?recursive=1`, fetcher);
  if (tree.truncated || !Array.isArray(tree.tree)) fail("E_SOURCE", "GitHub tree is truncated or invalid. Use a smaller repository or a local skill source.");
  const allPaths = new Set();
  for (const entry of tree.tree) {
    safeRelative(entry.path);
    if (allPaths.has(entry.path)) fail("E_SOURCE", "GitHub tree contains duplicate paths.");
    allPaths.add(entry.path);
  }
  const transport = { api, fetcher, cache: new Map() };
  if (name !== undefined) skillPath = await directoryByName(tree.tree, name, transport);
  const prefix = skillPath ? `${skillPath}/` : "";
  const entries = [];
  const seen = new Set();
  let totalSize = 0;
  for (const entry of tree.tree) {
    safeRelative(entry.path);
    if (!entry.path.startsWith(prefix) || entry.path === skillPath) continue;
    const relative = entry.path.slice(prefix.length);
    if (relative.split("/").some((part) => CONTROL_DIRS.has(part))) continue;
    safeRelative(relative);
    if (relative.split("/").length > 31) fail("E_LIMIT", "Skill directory nesting exceeds 30 levels.");
    if (seen.has(relative)) fail("E_SOURCE", "GitHub tree contains duplicate paths.");
    seen.add(relative);
    if (entry.type === "tree" && entry.mode === "040000") continue;
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) fail("E_UNSAFE_PATH", "Selected skill contains a symlink, submodule or unsupported Git entry.");
    if (!/^[a-f0-9]{40}$/.test(entry.sha ?? "") || !Number.isSafeInteger(entry.size) || entry.size < 0) fail("E_SOURCE", "GitHub tree contains invalid blob metadata.");
    totalSize += entry.size;
    if (entry.size > MAX_FILE_BYTES || entries.length >= MAX_FILES || totalSize > MAX_TREE_BYTES) fail("E_LIMIT", "GitHub skill exceeds the file count or byte limit.");
    entries.push({ ...entry, path: relative });
  }
  const files = [];
  for (const entry of entries) {
    const bytes = await readBlob(entry, transport);
    files.push({ path: entry.path, bytes, mode: entry.mode === "100755" ? 0o755 : 0o644 });
  }
  return { files, digest: digestFiles(files), source: { kind: "github", repository, skillPath, requestedRef, resolvedCommit } };
}

export async function acquireSource(input, { cwd, skill, name, ref, fetcher }) {
  if (typeof input !== "string" || !input) fail("E_ARGUMENT", "A local directory or GitHub repository is required.");
  let snapshot;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(input)) snapshot = await githubSnapshot(input, { skill, name, ref, fetcher });
  else {
    if (name !== undefined) fail("E_ARGUMENT", "--name is only supported for GitHub repository sources; pass a local skill directory directly.");
    if (ref !== undefined) fail("E_ARGUMENT", "--ref is only valid for GitHub sources.");
    const sourcePath = path.resolve(cwd, input, skill === undefined ? "" : safeRelative(skill, { allowRoot: true }));
    if (statOrNull(sourcePath)?.isSymbolicLink()) fail("E_UNSAFE_PATH", "Local skill source must not be a symlink.");
    snapshot = readTree(sourcePath, { excludeControlDirectories: true });
    snapshot.source = { kind: "local", path: fs.realpathSync(sourcePath) };
  }
  return { ...snapshot, ...skillMetadata(snapshot.files) };
}
