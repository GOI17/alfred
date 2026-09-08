#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { inspectRuntime } from "./runtime-archive.mjs";
import { sha256 } from "./build-runtime.mjs";

const directory = resolve(process.argv[2] ?? "");
const names = readdirSync(directory).filter((name) => /^alfred-\d+\.\d+\.\d+-runtime\.tar\.gz$/.test(name));
assert.equal(names.length, 1, "Expected exactly one runtime archive");
const archive = readFileSync(join(directory, names[0]));
const manifestBytes = readFileSync(join(directory, "runtime-manifest.json"));
const checked = inspectRuntime(archive, manifestBytes);
if (process.env.REVIEWED_SHA256) assert.equal(sha256(archive), process.env.REVIEWED_SHA256, "Candidate differs from reviewed checksum");
assert.equal(readFileSync(join(directory, `${names[0]}.sha256`), "utf8"), `${sha256(archive)}  ${names[0]}\n`);
const formula = readFileSync(join(directory, "alfred.rb"));
assert.equal(readFileSync(join(directory, "alfred.rb.sha256"), "utf8"), `${sha256(formula)}  alfred.rb\n`);
if (process.env.REVIEWED_FORMULA_SHA256) assert.equal(sha256(formula), process.env.REVIEWED_FORMULA_SHA256);
if (process.argv.includes("--archive-only")) {
  process.stdout.write(`${JSON.stringify({ status: "pass", verification: "archive-integrity-only", sha256: sha256(archive) })}\n`);
} else {
  const temporary = mkdtempSync(join(tmpdir(), "alfred-runtime-smoke-"));
  const runtime = join(temporary, "runtime"), home = join(temporary, "home"), workspace = join(temporary, "workspace");
  mkdirSync(runtime); mkdirSync(home); mkdirSync(workspace);
  const server = createServer((request, response) => {
    if (request.headers.authorization || request.headers.cookie) { response.writeHead(403).end(); return; }
    response.writeHead(200, { "Content-Type": "application/gzip" }); response.end(archive);
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/${names[0]}`);
    assert.equal(response.status, 200);
    const downloaded = Buffer.from(await response.arrayBuffer());
    assert.equal(sha256(downloaded), sha256(archive));
    const { files } = inspectRuntime(downloaded, manifestBytes);
    for (const [path, file] of files) {
      const target = join(runtime, path); mkdirSync(dirname(target), { recursive: true });
      const temporaryFile = `${target}.tmp`; writeFileSync(temporaryFile, file.bytes); chmodSync(temporaryFile, file.mode); renameSync(temporaryFile, target);
    }
    const env = { PATH: process.env.PATH, HOME: home, TMPDIR: temporary, ALFRED_MEMORY_REGISTRY: join(home, "registry.sqlite"), ALFRED_DISTRIBUTION: "homebrew", ALFRED_INSTALL_TUI_BACKEND: "node", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
    const run = (args, cwd = workspace) => {
      const result = spawnSync(process.execPath, args, { cwd, env, encoding: "utf8", timeout: 30000 });
      assert.equal(result.status, 0, `Runtime smoke failed: ${args.join(" ")}\n${result.stderr}`);
      return result.stdout;
    };
    const cli = join(runtime, "packages/memory-server/scripts/alfred.mjs");
    assert.equal(run([cli, "version"]).trim(), `alfred ${checked.manifest.version}`);
    const preview = run([cli, "setup", "--edition=coding", "--name=runtime-smoke", "--harness=none"]);
    assert.match(preview, /ALFRED SUITE INSTALL PREVIEW/);
    assert.doesNotMatch(preview, /raw\.githubusercontent\.com|codeload\.github\.com/);
    run([cli, "init", "--profile=coding", "--name", "runtime-smoke", "--non-interactive"]);
    assert.match(run([cli, "list"]), /runtime-smoke/);
    run([cli, "serve"]);
    run(["--input-type=module", "-e", `
      import { createRequire } from 'node:module';
      import { pathToFileURL } from 'node:url';
      const require = createRequire(process.cwd() + '/package.json');
      for (const name of ['pg', 'nodemailer', '@modelcontextprotocol/sdk/server/mcp.js', 'zod/v4', '@alfred-labs/memory-client']) {
        const path = require.resolve(name);
        if (!path.startsWith(process.cwd() + '/node_modules/')) throw new Error('Dependency escaped runtime: ' + name);
        await import(pathToFileURL(path).href);
      }
      const { buildCodexInstallPreview } = await import('./packages/codex-adapter/src/runtime.js');
      const { buildOpencodeInstallPreview } = await import('./packages/opencode-adapter/src/runtime.js');
      for (const build of [buildCodexInstallPreview, buildOpencodeInstallPreview]) {
        const preview = build({ root: process.cwd(), projectRoot: process.cwd() });
        if (!preview.files.some(file => file.kind === 'agent') || !preview.files.some(file => file.kind === 'skill')) throw new Error('Incomplete coding preview');
      }
    `], runtime);
    process.stdout.write(`${JSON.stringify({ status: "pass", verification: "anonymous-local-http,archive-integrity,CLI,SQLite,server,dependencies,coding-previews", version: checked.manifest.version, sha256: sha256(archive), public_github_install: "pending-publication-approval", provider_calls: 0 })}\n`);
  } finally { await new Promise((done) => server.close(done)); rmSync(temporary, { recursive: true, force: true }); }
}
