import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..", "..");
const schemaPath = resolve(root, "packages", "memory-openapi", "openapi.yaml");
const schema = readFileSync(schemaPath, "utf8");
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

test("ChatGPT uses the canonical hosted OpenAPI schema", () => {
  assert.match(schema, /url: https:\/\/alfred-labs-memory\.fly\.dev/);
  assert.match(schema, /authorizationUrl: https:\/\/alfred-labs-memory\.fly\.dev\/oauth\/authorize/);
  assert.match(schema, /tokenUrl: https:\/\/alfred-labs-memory\.fly\.dev\/oauth\/token/);
});

test("ChatGPT schema declares read and write OAuth scopes", () => {
  assert.match(schema, /^\s+memory:read:/m);
  assert.match(schema, /^\s+memory:write:/m);
  assert.doesNotMatch(schema, /type:\s*http\s+[\s\S]*scheme:\s*bearer/);
});

test("legacy ChatGPT bridge and duplicate schema are removed", () => {
  assert.equal(existsSync(resolve(root, "packages", "chatgpt-adapter", "src", "bridge.mjs")), false);
  assert.equal(existsSync(resolve(root, "packages", "chatgpt-adapter", "openapi.json")), false);
});

test("ChatGPT setup documentation requires OAuth and no bridge", () => {
  const readme = readFileSync(resolve(root, "packages", "chatgpt-adapter", "README.md"), "utf8");
  assert.match(readme, /Choose \*\*OAuth\*\*/);
  assert.match(readme, /No\s+local bridge is required/);
  assert.doesNotMatch(readme, /node packages\/chatgpt-adapter\/src\/bridge\.mjs/);
});

test("schema has no placeholder server and identifies the current contract", () => {
  assert.match(schema, new RegExp(`version: ${version.replaceAll(".", "\\.")}`));
  assert.doesNotMatch(schema, /memory\.example\.com|alfred-memory\.example\.com/);
});

test("schema exposes the ten approved ChatGPT operation identifiers", () => {
  for (const operationId of [
    "healthCheck", "listAgents", "listSkills", "checkPolicy", "searchMemories",
    "listMemories", "getMemory", "createMemory", "updateMemory", "deleteMemory"
  ]) {
    assert.match(schema, new RegExp(`operationId: ${operationId}(?:\\s|$)`));
  }
  assert.doesNotMatch(schema, /searchMemoriesV2|\/memories\/search:/);
});

test("all memory mutations remain consequential", () => {
  for (const operationId of ["createMemory", "updateMemory", "deleteMemory"]) {
    const start = schema.indexOf(`operationId: ${operationId}`);
    assert.ok(start >= 0, `${operationId} must exist`);
    const window = schema.slice(start, start + 500);
    assert.match(window, /x-openai-isConsequential: true/);
  }
});

test("OAuth implementation and persistent credential tables ship with the server", () => {
  const service = readFileSync(resolve(root, "packages", "memory-server", "src", "oauth", "oauth-service.js"), "utf8");
  const migration = readFileSync(resolve(root, "packages", "memory-server", "migrations", "sqlite_registry.sql"), "utf8");
  assert.match(service, /state is required/);
  assert.match(service, /refresh_token_reuse_detected/);
  assert.match(migration, /oauth_authorization_codes/);
  assert.match(migration, /oauth_tokens/);
});

test("existing API keys remain supported outside ChatGPT OAuth", () => {
  const readme = readFileSync(resolve(root, "packages", "chatgpt-adapter", "README.md"), "utf8");
  assert.match(readme, /Existing API-key authentication remains available/);
  assert.match(readme, /CLI and technical/);
});

test("console and setup instructions contain no ChatGPT bridge command", () => {
  const files = [
    resolve(root, "packages", "console-web", "src", "index.html"),
    resolve(root, "packages", "memory-server", "src", "profiles", "init-profiles.js"),
    resolve(root, "packages", "memory-server", "scripts", "adapters.mjs")
  ];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    assert.doesNotMatch(content, /chatgpt-adapter\/src\/bridge\.mjs/, file);
  }
});

test("deployment guide documents exact current ChatGPT callback variants", () => {
  const guide = readFileSync(resolve(root, ".ai", "docs", "custom-gpt-deploy.md"), "utf8");
  assert.match(guide, /https:\/\/chatgpt\.com\/aip\/g-YOUR-GPT-ID\/oauth\/callback/);
  assert.match(guide, /https:\/\/chat\.openai\.com\/aip\/g-YOUR-GPT-ID\/oauth\/callback/);
  assert.match(guide, /exact URLs/);
  assert.doesNotMatch(guide, /wildcard redirect URLs? (?:are )?allowed/i);
});
