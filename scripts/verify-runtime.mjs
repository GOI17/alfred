#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { inspectRuntime } from "./runtime-archive.mjs";
import { sha256 } from "./build-runtime.mjs";
import { renderFormula } from "./generate-homebrew-formula.mjs";
import { downloadAnonymous } from "./publish-homebrew-runtime.mjs";

function atomic(path, bytes, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, bytes); chmodSync(temporary, mode); renameSync(temporary, path);
}

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
assert.deepEqual(formula, Buffer.from(renderFormula({ source: "release", version: checked.manifest.version, sha256: sha256(archive) })), "Formula does not match runtime URL/version/hash");
if (process.env.REVIEWED_FORMULA_SHA256) assert.equal(sha256(formula), process.env.REVIEWED_FORMULA_SHA256);
if (process.argv.includes("--archive-only")) {
  process.stdout.write(`${JSON.stringify({ status: "pass", verification: "archive-integrity-only", sha256: sha256(archive) })}\n`);
} else {
  const temporary = mkdtempSync(join(tmpdir(), "alfred-runtime-smoke-"));
  const runtime = join(temporary, "runtime with spaces"), home = join(temporary, "home with spaces"), workspace = join(temporary, "workspace with spaces");
  const deniedNetwork = join(temporary, "denied-network.log"), blockedBin = join(temporary, "blocked-bin");
  mkdirSync(runtime); mkdirSync(home); mkdirSync(workspace); mkdirSync(blockedBin);
  for (const command of ["curl", "wget", "gh", "npm", "npx", "brew"]) {
    atomic(join(blockedBin, command), '#!/bin/sh\nprintf "blocked shell network/package command\\n" >> "$ALFRED_SMOKE_DENIED_NETWORK"\nexit 97\n', 0o755);
  }
  atomic(join(blockedBin, "git"), '#!/bin/sh\nif [ "$1" = "-C" ]; then shift 2; fi\nif [ "$1" = "rev-parse" ]; then exit 1; fi\nprintf "blocked git mutation/network command\\n" >> "$ALFRED_SMOKE_DENIED_NETWORK"\nexit 97\n', 0o755);
  const networkGuard = join(temporary, "network-guard.mjs");
  atomic(networkGuard, `
    import net from 'node:net';
    import { appendFileSync } from 'node:fs';
    const connect = net.Socket.prototype.connect;
    net.Socket.prototype.connect = function (...input) {
      const args = Array.isArray(input[0]) ? input[0] : input;
      const options = args[0];
      const host = typeof options === 'object' ? options.host ?? 'localhost' : typeof args[1] === 'string' ? args[1] : 'localhost';
      if (!['localhost', '127.0.0.1', '::1'].includes(host) || typeof options === 'object' && options.path) {
        appendFileSync(process.env.ALFRED_SMOKE_DENIED_NETWORK, 'blocked non-loopback socket\\n');
        throw new Error('Runtime smoke forbids external network');
      }
      return connect.apply(this, input);
    };
  `);
  const env = { PATH: [blockedBin, dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter), HOME: home, TMPDIR: temporary, ALFRED_MEMORY_REGISTRY: join(home, "registry.sqlite"), ALFRED_DISTRIBUTION: "homebrew", ALFRED_INSTALL_TUI_BACKEND: "node", ALFRED_SMOKE_DENIED_NETWORK: deniedNetwork, NODE_OPTIONS: `--import=${pathToFileURL(networkGuard).href}`, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
  const server = createServer((request, response) => {
    if (request.headers.authorization || request.headers.cookie) { response.writeHead(403).end(); return; }
    response.writeHead(200, { "Content-Type": "application/gzip" }); response.end(archive);
  });
  let service = null, serviceClosed = null, serviceStderr = "";
  await new Promise((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", done); });
  try {
    const downloaded = await downloadAnonymous(`http://127.0.0.1:${server.address().port}/${names[0]}`);
    assert.equal(sha256(downloaded), sha256(archive));
    const { files } = inspectRuntime(downloaded, manifestBytes);
    for (const [path, file] of files) atomic(join(runtime, path), file.bytes, file.mode);
    const run = (args, cwd = workspace, extraEnv = {}) => {
      const result = spawnSync(process.execPath, args, { cwd, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 30000 });
      assert.equal(result.status, 0, `Runtime smoke failed: ${args.slice(0, 2).join(" ")}\n${result.stderr}`);
      return result.stdout;
    };
    const cli = join(runtime, "packages/memory-server/scripts/alfred.mjs");
    const wrapper = join(temporary, "bin with spaces", "alfred");
    const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
    atomic(wrapper, `#!/bin/sh\nALFRED_DISTRIBUTION=homebrew exec ${shellQuote(process.execPath)} ${shellQuote(cli)} "$@"\n`, 0o755);
    const wrapped = spawnSync(wrapper, ["version"], { cwd: workspace, env, encoding: "utf8", timeout: 10000 });
    assert.equal(wrapped.status, 0, "Relocated formula wrapper failed: " + wrapped.stderr);
    assert.equal(wrapped.stdout.trim(), `alfred ${checked.manifest.version}`);
    const preview = run([cli, "setup", "--edition=coding", "--name=runtime-smoke", "--harness=none"]);
    assert.match(preview, /ALFRED SUITE INSTALL PREVIEW/);
    assert.doesNotMatch(preview, /raw\.githubusercontent\.com|codeload\.github\.com/);
    const guided = run([cli, "setup"], workspace, { ALFRED_INSTALL_APP_TUI_EVENTS: "set:edition=coding,set:harnesses=none,set:profiles=false,set:name=guided-smoke,set:apply=false,submit" });
    assert.match(guided, /ALFRED SUITE INSTALL PREVIEW/);
    assert.ok(!existsSync(join(workspace, ".alfred")), "Setup preview wrote workspace configuration");
    const initialized = JSON.parse(run([cli, "init", "--profile=coding", "--name", "runtime-smoke", "--non-interactive"]));
    assert.equal(initialized.ok, true);
    assert.match(run([cli, "list"]), /runtime-smoke/);
    assert.ok(existsSync(join(home, "registry.sqlite")), "CLI did not create isolated SQLite registry");

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
      const { buildPiInstallPreview } = await import('./packages/pi-adapter/src/runtime.js');
      for (const build of [buildCodexInstallPreview, buildOpencodeInstallPreview, buildPiInstallPreview]) {
        const preview = build({ root: process.cwd(), projectRoot: process.cwd() });
        if (!preview.files.some(file => file.kind === 'agent') || !preview.files.some(file => ['skill', 'skills-registry'].includes(file.kind))) throw new Error('Incomplete coding preview');
      }
    `], runtime);

    const reserve = createServer();
    await new Promise((done, reject) => { reserve.once("error", reject); reserve.listen(0, "127.0.0.1", done); });
    const port = reserve.address().port;
    await new Promise((done) => reserve.close(done));
    const origin = `http://127.0.0.1:${port}`;
    service = spawn(process.execPath, [cli, "serve"], { cwd: runtime, env: { ...env, ALFRED_MEMORY_BIND: "127.0.0.1", ALFRED_MEMORY_PORT: String(port), ALFRED_MEMORY_REQUIRE_AUTH: "true" }, stdio: ["ignore", "pipe", "pipe"] });
    service.stdout.on("data", () => {});
    service.stderr.on("data", (chunk) => { serviceStderr += chunk; });
    serviceClosed = new Promise((done) => service.once("close", (code, signal) => done({ code, signal })));
    let spawnError;
    service.once("error", (error) => { spawnError = error; });
    let healthy = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError;
      assert.equal(service.exitCode, null, `alfred serve exited before readiness: ${serviceStderr}`);
      try {
        const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(500) });
        if (response.status === 200 && (await response.json()).status === "ok") { healthy = true; break; }
      } catch {}
      await delay(50);
    }
    assert.ok(healthy, `alfred serve failed readiness: ${serviceStderr}`);
    for (const path of ["/console/", "/openapi.yaml", "/.well-known/oauth-protected-resource/mcp"]) {
      const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(response.status, 200, `Runtime HTTP surface unavailable: ${path}`);
      const body = await response.text();
      assert.ok(body.length > 20, `Runtime HTTP surface empty: ${path}`);
    }
    const anonymousMemories = await fetch(`${origin}/memories`, { signal: AbortSignal.timeout(5000) });
    assert.equal(anonymousMemories.status, 401, "Memory data must require the generated tenant credential");
    const httpCreatedResponse = await fetch(`${origin}/memories`, { method: "POST", headers: { "content-type": "application/json", "x-api-key": initialized.api_key }, body: JSON.stringify({ type: "fact", content: "HTTP runtime evidence", source: "isolated-qa" }), signal: AbortSignal.timeout(5000) });
    const httpCreated = await httpCreatedResponse.json();
    assert.equal(httpCreatedResponse.status, 201, "Packaged HTTP create failed: " + JSON.stringify(httpCreated));
    assert.ok(httpCreated.id, "Packaged HTTP create did not return a memory ID");
    // The packaged SDK client launches the packaged MCP CLI, which calls the
    // running packaged HTTP server and its real temporary SQLite store.
    run(["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import { Client } from '@modelcontextprotocol/sdk/client/index.js';
      import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
      const client = new Client({ name: 'runtime-smoke', version: '1.0.0' });
      const transport = new StdioClientTransport({ command: process.execPath, args: [process.cwd() + '/packages/memory-mcp/src/cli.js'], cwd: process.cwd(), env: process.env, stderr: 'pipe' });
      try {
        await client.connect(transport);
        assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['memory_search', 'memory_create', 'memory_update', 'memory_delete', 'memory_list']);
        const call = async (name, args) => {
          const result = await client.callTool({ name, arguments: args });
          assert.ok(!result.isError, 'Packaged MCP tool failed: ' + name + ' ' + JSON.stringify(result));
          return result.structuredContent;
        };
        const created = await call('memory_create', { type: 'fact', content: 'Runtime smoke evidence', source: 'isolated-qa' });
        assert.ok(created.id);
        assert.ok((await call('memory_list', {})).items.some(item => item.id === created.id));
        await call('memory_update', { id: created.id, patch: { content: 'Updated runtime evidence' } });
        assert.ok((await call('memory_search', { q: 'Updated runtime evidence' })).items.some(item => item.id === created.id));
        assert.equal((await call('memory_delete', { id: created.id })).deleted, true);
        assert.ok(!(await call('memory_list', {})).items.some(item => item.id === created.id));
      } finally { await client.close(); }
    `], runtime, { ALFRED_MEMORY_BASE_URL: origin, ALFRED_MEMORY_API_KEY: initialized.api_key });
    assert.ok(!existsSync(deniedNetwork), "Runtime attempted a blocked network/package operation");
    assert.ok(!existsSync(join(home, ".codex")) && !existsSync(join(home, ".config")), "Smoke wrote live harness configuration");
    service.kill("SIGTERM");
    const stopped = await Promise.race([serviceClosed, delay(5000).then(() => null)]);
    assert.equal(stopped?.code, 0, "Packaged HTTP server did not shut down cleanly");
    service = null;
    process.stdout.write(`${JSON.stringify({ status: "pass", verification: "anonymous-local-http,archive-integrity,relocated-wrapper,CLI,guided-setup-preview,SQLite,MCP-stdio-CRUD,live-HTTP,dependencies,coding-previews", version: checked.manifest.version, sha256: sha256(archive), public_github_install: "pending-publication-approval", external_network_attempts: 0, provider_calls: 0 })}\n`);
  } finally {
    if (service) { service.kill("SIGKILL"); await serviceClosed; }
    await new Promise((done) => server.close(done));
    rmSync(temporary, { recursive: true, force: true });
  }
}
