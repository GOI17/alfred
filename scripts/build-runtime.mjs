#!/usr/bin/env node
// Build a reviewed runtime, never an archive of the source checkout.
import { renderFormula } from "./generate-homebrew-formula.mjs";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, fsyncSync, openSync, unlinkSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const denied = /(?:^|\/)(?:\.git|\.github|\.opencode|\.codex|\.agents|\.env[^/]*|\.npmrc|\.netrc|\.ssh|profiles\.local|test|tests|__tests__|fixtures|coverage)(?:\/|$)|^\.ai\/(?:execution|releases|observability|reports|generated|evals|roadmaps)(?:\/|$)|\.(?:pem|key|sqlite|sqlite3|db)$/i;
export function assertSafePath(path) {
  if (!path || /[\x00-\x1f\x7f]/.test(path) || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => !part || part === "." || part === "..") || denied.test(path)) {
    throw new Error(`Unsafe runtime path: ${path}`);
  }
}
function inside(parent, child) { return child === parent || child.startsWith(`${parent}${sep}`); }
export function writeAssetAtomic(path, bytes) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.alfred-asset-${randomUUID()}.tmp`);
  const fd = openSync(temporary, "wx", 0o644);
  try {
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, path);
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}
const atomic = writeAssetAtomic;

function cleanMetadata(metadata) {
  return Object.fromEntries(["name", "version", "type", "main", "module", "exports", "bin", "license", "engines"].filter((key) => metadata[key] !== undefined).map((key) => [key, metadata[key]]));
}
function regexFor(pattern) {
  assertSafePath(pattern);
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.slice(i, i + 3) === "**/") { regex += "(?:.*/)?"; i += 2; }
    else if (pattern[i] === "*") regex += "[^/]*";
    else regex += pattern[i].replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`${regex}$`);
}
function checkedInput(root, name) {
  assertSafePath(name);
  let path = root;
  for (const part of name.split("/")) {
    path = join(path, part);
    if (lstatSync(path).isSymbolicLink()) throw new Error(`Symlink is not a runtime input: ${name}`);
  }
  if (!inside(root, realpathSync(path))) throw new Error(`Runtime input escapes its root: ${name}`);
  return path;
}
function filesMatching(root, pattern) {
  const matcher = regexFor(pattern);
  const prefix = pattern.includes("*") ? pattern.slice(0, pattern.indexOf("*")).replace(/[^/]*$/, "").replace(/\/$/, "") : pattern;
  if (!existsSync(join(root, prefix))) return [];
  const start = prefix ? checkedInput(root, prefix) : root;
  const files = [];
  function visit(path) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Symlink is not a runtime input: ${relative(root, path)}`);
    if (stat.isDirectory()) for (const entry of readdirSync(path).sort()) visit(join(path, entry));
    else if (stat.isFile()) {
      const name = relative(root, path).split(sep).join("/");
      if (matcher.test(name)) files.push(name);
    } else throw new Error(`Unsupported runtime input: ${path}`);
  }
  visit(start);
  return files;
}
function assertNoSecrets(path, bytes) {
  const text = bytes.toString("utf8");
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----\s+[A-Za-z0-9+/=]{32,}|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/.test(text)) {
    throw new Error(`Possible credential in runtime input: ${path}`);
  }
}
// USTAR uses normalized metadata; no source checkout metadata reaches the archive.
export function createTar(files) {
  const chunks = [];
  for (const [path, file] of [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    assertSafePath(path);
    const header = Buffer.alloc(512);
    let name = path, prefix = "";
    if (Buffer.byteLength(name) > 100) {
      const split = path.lastIndexOf("/"); prefix = path.slice(0, split); name = path.slice(split + 1);
    }
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`Runtime path exceeds USTAR limit: ${path}`);
    header.write(name, 0, 100);
    const octal = (value, offset, length) => header.write(value.toString(8).padStart(length - 1, "0") + "\0", offset, length);
    octal(file.mode, 100, 8); octal(0, 108, 8); octal(0, 116, 8);
    octal(file.bytes.length, 124, 12); octal(0, 136, 12);
    header.fill(32, 148, 156); header.write("0", 156); header.write("ustar\0", 257); header.write("00", 263); header.write(prefix, 345, 155);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
    chunks.push(header, file.bytes, Buffer.alloc((512 - file.bytes.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}
export function buildRuntime({ root, dependencies, output, sourceRevision, builderRevision, exploratory = false, allowlist = join(repositoryRoot, "packaging/runtime/allowlist.json") }) {
  root = realpathSync(resolve(root)); dependencies = realpathSync(resolve(dependencies)); output = resolve(output);
  const existingOutputParent = (() => { let p = output; while (!existsSync(p)) p = dirname(p); return realpathSync(p); })();
  if (inside(root, output) || inside(output, root) || inside(dependencies, output) || inside(output, dependencies) || inside(root, existingOutputParent) || inside(dependencies, existingOutputParent)) throw new Error("Runtime output must not overlap source or dependencies");
  if (!/^[a-f0-9]{40}$/.test(sourceRevision ?? "")) throw new Error("An exact source revision is required");
  if (!/^[a-f0-9]{40}$/.test(builderRevision ?? "")) throw new Error("An exact builder revision is required");
  const allowlistBytes = readFileSync(allowlist);
  const policy = JSON.parse(allowlistBytes);
  if (policy.schema !== "alfred.runtime.allowlist/v1") throw new Error("Unknown runtime allowlist schema");
  const version = JSON.parse(readFileSync(checkedInput(root, "package.json"), "utf8")).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Runtime requires stable semantic version");
  const files = new Map();
  const add = (name, bytes, mode = 0o644) => {
    assertSafePath(name); assertNoSecrets(name, bytes);
    if (files.has(name)) throw new Error(`Duplicate runtime path: ${name}`);
    files.set(name, { bytes, mode });
  };
  for (const pattern of policy.includes) {
    const matches = filesMatching(root, pattern);
    if (!matches.length) throw new Error(`Missing required runtime input: ${pattern}`);
    for (const name of matches) add(name, readFileSync(checkedInput(root, name)), name === "install.sh" ? 0o755 : 0o644);
  }
  add("package.json", jsonBytes({ name: "alfred", version, private: true, description: "Readable Alfred runtime; source repository history is not included." }));
  for (const packageName of policy.packageMetadata ?? []) {
    assertSafePath(packageName);
    const path = `packages/${packageName}/package.json`;
    add(path, jsonBytes(cleanMetadata(JSON.parse(readFileSync(checkedInput(root, path), "utf8")))));
  }
  if (policy.generatedRuntimeMetadata) {
    add(".ai/manifest.json", jsonBytes({ name: "alfred", version, phase: "runtime-distribution", status: "complete", source_of_truth: {
      agent_system: ".ai", routing_policy: ".ai/agents/routing-policy.json", skill_registry: ".ai/skills/registry.json",
      model_assignment_policy: ".ai/policies/model-assignment.md", harness_compatibility: ".ai/harnesses/compatibility-matrix.json",
      install_components: ".ai/install/components.json", instructions_install_management: ".ai/instructions/install-management.md"
    } }));
    add(".ai/instructions/install-management.md", Buffer.from(`# Alfred runtime configuration\n\nRun \`alfred setup\` from the installed runtime. Choose edition, harness and runtime profile strategy; inspect the preview before approving writes. Use \`--edition=coding --name=example --harness=none\` for a read-only CLI preview. Use \`--apply\` only after reviewing the plan and explicitly approving configuration. Harness artifacts are generated first; copying them into live harness directories requires a separate choice. Never clone main or download a different installer while configuring the packaged runtime. Model assignments remain user-owned runtime configuration; setup does not write a models file. Human operators install/update/remove the package through the fully qualified Homebrew formula \`GOI17/alfred/alfred\`. This package includes runtime agent/skill/policy metadata; internal historical evaluation runners and their release/execution records are excluded.\n`));
    const components = JSON.parse(files.get(".ai/install/components.json").bytes);
    components.components = components.components.filter((entry) => entry.id !== "evals");
    for (const edition of components.editions) edition.components = edition.components.filter((id) => id !== "evals");
    files.set(".ai/install/components.json", { bytes: jsonBytes(components), mode: 0o644 });
  }
  // Require the exact isolated production closure, not arbitrary node_modules.
  const lockPath = join(dirname(dependencies), "package-lock.json");
  if (lstatSync(lockPath).isSymbolicLink()) throw new Error("Dependency lock must not be a symlink");
  const lockBytes = readFileSync(lockPath);
  const reviewedLockPath = join(dirname(allowlist), "package-lock.json");
  if (lstatSync(reviewedLockPath).isSymbolicLink() || !lstatSync(reviewedLockPath).isFile()) throw new Error("Reviewed dependency lock must be a regular file");
  if (!lockBytes.equals(readFileSync(reviewedLockPath))) throw new Error("Staged dependency lock differs from reviewed lock");
  const lock = JSON.parse(lockBytes);
  if (lock.lockfileVersion !== 3 || !lock.packages) throw new Error("A production npm lockfile v3 is required");
  const lockedPackages = new Map(Object.entries(lock.packages).filter(([path]) => path.startsWith("node_modules/")));
  const discoveredPackages = new Set();
  function checkPackageDirectory(directory, prefix = "node_modules") {
    if (lstatSync(directory).isSymbolicLink()) throw new Error(`Dependency directory symlink is not allowed: ${prefix}`);
    for (const entry of readdirSync(directory)) {
      if (entry === ".bin" || entry === ".package-lock.json") continue;
      const path = join(directory, entry), name = `${prefix}/${entry}`;
      if (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) throw new Error(`Unexpected dependency entry: ${name}`);
      if (entry.startsWith("@")) { checkPackageDirectory(path, name); continue; }
      const expected = lockedPackages.get(name);
      if (!expected || expected.dev || expected.link || !expected.integrity || !expected.resolved?.startsWith("https://registry.npmjs.org/")) throw new Error(`Dependency outside production lock: ${name}`);
      const metadata = JSON.parse(readFileSync(checkedInput(dependencies, `${name.slice("node_modules/".length)}/package.json`), "utf8"));
      if (metadata.version !== expected.version) throw new Error(`Locked dependency version mismatch: ${name}`);
      discoveredPackages.add(name);
      if (existsSync(join(path, "node_modules"))) checkPackageDirectory(join(path, "node_modules"), `${name}/node_modules`);
    }
  }
  checkPackageDirectory(dependencies);
  for (const [name, entry] of lockedPackages) if (!entry.dev && !entry.optional && !discoveredPackages.has(name)) throw new Error(`Missing locked production dependency: ${name}`);
  // npm's executable symlinks and development files are not runtime imports.
  function vendor(directory, prefix = "node_modules") {
    for (const entry of readdirSync(directory).sort()) {
      if (entry === ".bin" || entry === ".package-lock.json") continue;
      const path = join(directory, entry), name = `${prefix}/${entry}`;
      if (/(?:^|\/)(?:\.github|spec|test|tests|__tests__|fixtures|coverage|docs|examples)(?:\/|$)/i.test(name) || /(?:\.d\.[cm]ts|\.(?:map|ts))$/.test(name) || /(?:^|\/)(?:\.travis\.yml|\.eslintrc[^/]*|Makefile)$/.test(name)) continue;
      assertSafePath(name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`Dependency symlink is not allowed: ${name}`);
      if (stat.isDirectory()) vendor(path, name);
      else if (stat.isFile()) add(name, readFileSync(path));
      else throw new Error(`Unsupported dependency input: ${name}`);
    }
  }
  for (const [name, expected] of Object.entries(policy.dependencies ?? {})) {
    assertSafePath(name);
    const metadata = JSON.parse(readFileSync(checkedInput(dependencies, `${name}/package.json`), "utf8"));
    if (metadata.name !== name || metadata.version !== expected) throw new Error(`Dependency version mismatch: ${name}`);
  }
  vendor(dependencies);
  for (const [name, source] of Object.entries(policy.workspaceModules ?? {})) {
    assertSafePath(name); assertSafePath(source);
    for (const [path, file] of [...files]) if (path.startsWith(`${source}/`)) add(`node_modules/${name}/${path.slice(source.length + 1)}`, file.bytes, file.mode);
  }
  // Console source is self-contained; give the runtime router its standard path.
  const consoleSource = files.get("packages/console-web/src/index.html");
  if (consoleSource) {
    files.delete("packages/console-web/src/index.html");
    add("packages/console-web/dist/index.html", consoleSource.bytes);
  }
  add("RUNTIME-DISCLOSURE.txt", Buffer.from("Alfred runtime includes readable JavaScript, shell, HTML, SQL, agent and skill instructions, and third-party production dependencies with their licenses. It is not an opaque native binary. Source checkout history, workflows, tests, execution specifications and local credentials are excluded. Node is required. Optional OpenTUI and Transformers are not bundled; Node TUI and keyword search remain available.\n"));
  const manifest = { schema: "alfred.runtime.manifest/v1", version,
    provenance: { source_revision: sourceRevision, builder_revision: builderRevision, exploratory, generator_sha256: sha256(readFileSync(join(repositoryRoot, "scripts/generate-homebrew-formula.mjs"))), builder_sha256: sha256(readFileSync(fileURLToPath(import.meta.url))), allowlist_sha256: sha256(allowlistBytes), dependencies_lock_sha256: sha256(lockBytes), source_repository: "GOI17/alfred" },
    transformations: ["root and package metadata reduced to runtime fields", "console HTML relocated to runtime dist path", "workspace module copies materialized inside node_modules", "mtime/ownership/modes normalized", "development files omitted from production dependencies", ...(policy.generatedRuntimeMetadata ? ["minimal runtime kernel manifest and install instructions generated", "historical eval runner removed from runtime component metadata"] : [])],
    files: [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, file]) => ({ path, size: file.bytes.length, mode: file.mode.toString(8), sha256: sha256(file.bytes) })) };
  const manifestBytes = jsonBytes(manifest);
  add("runtime-manifest.json", manifestBytes);
  const archive = gzipSync(createTar(files), { level: 9, mtime: 0 });
  const name = `alfred-${version}-runtime.tar.gz`;
  const digest = sha256(archive);
  atomic(join(output, name), archive);
  atomic(join(output, "runtime-manifest.json"), manifestBytes);
  atomic(join(output, `${name}.sha256`), Buffer.from(`${digest}  ${name}\n`));
  const formula = Buffer.from(renderFormula({ source: "release", version, sha256: digest }));
  atomic(join(output, "alfred.rb"), formula);
  atomic(join(output, "alfred.rb.sha256"), Buffer.from(`${sha256(formula)}  alfred.rb\n`));
  atomic(join(output, "SHA256SUMS"), Buffer.from(`${digest}  ${name}\n${sha256(manifestBytes)}  runtime-manifest.json\n${sha256(formula)}  alfred.rb\n`));
  return { version, source_revision: sourceRevision, archive: join(output, name), sha256: digest, formula_sha256: sha256(formula), file_count: files.size, provider_calls: 0 };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const flag = process.argv[i];
      if (flag === "--exploratory") { options.exploratory = true; i -= 1; continue; }
      if (!["--root", "--dependencies", "--output", "--allowlist", "--source-revision", "--builder-revision"].includes(flag) || !process.argv[i + 1]) throw new Error(`Invalid runtime build argument: ${flag}`);
      options[flag === "--source-revision" ? "sourceRevision" : flag === "--builder-revision" ? "builderRevision" : flag.slice(2)] = process.argv[i + 1];
    }
    if (!options.root || !options.dependencies || !options.output) throw new Error("Required: --root --dependencies --output");
    process.stdout.write(`${JSON.stringify(buildRuntime(options))}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
