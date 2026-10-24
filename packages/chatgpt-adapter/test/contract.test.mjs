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

test("ChatGPT documentation directs users to local Memory and rejects retired cloud onboarding", () => {
  const readme = readFileSync(resolve(root, "packages", "chatgpt-adapter", "README.md"), "utf8").replace(/\s+/g, " ");
  assert.match(readme, /only as a local loopback service/);
  assert.match(readme, /managed hosted endpoint has been retired/);
  assert.match(readme, /Cloud ChatGPT Actions cannot reach this service/);
  assert.match(readme, /no supported cloud Custom GPT connection flow/);
  assert.match(readme, /\[local quickstart\]\(\.\.\/\.\.\/docs\/QUICKSTART\.md\)/);
  assert.match(readme, /http:\/\/127\.0\.0\.1:3000\/console\//);
  assert.doesNotMatch(readme, /node packages\/chatgpt-adapter\/src\/bridge\.mjs/);
});

test("schema has no placeholder server and identifies the current contract", () => {
  assert.match(schema, new RegExp(`version: ${version.replaceAll(".", "\\.")}`));
  assert.doesNotMatch(schema, /memory\.example\.com|alfred-memory\.example\.com/);
});

test("schema exposes the eleven approved ChatGPT operation identifiers", () => {
  for (const operationId of [
    "healthCheck", "listAgents", "listSkills", "checkPolicy", "searchMemories",
    "listMemories", "getMemory", "captureMemory", "createMemory", "updateMemory", "deleteMemory"
  ]) {
    assert.match(schema, new RegExp(`operationId: ${operationId}(?:\\s|$)`));
  }
  assert.doesNotMatch(schema, /searchMemoriesV2|\/memories\/search:/);
});

test("all memory mutations remain consequential", () => {
  for (const operationId of ["createMemory", "captureMemory", "updateMemory", "deleteMemory"]) {
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

test("local API-key and MCP onboarding preserves authentication without exposing Memory remotely", () => {
  const readme = readFileSync(resolve(root, "packages", "chatgpt-adapter", "README.md"), "utf8").replace(/\s+/g, " ");
  const quickstart = readFileSync(resolve(root, "docs", "QUICKSTART.md"), "utf8").replace(/\s+/g, " ");
  assert.match(readme, /API key issued by `alfred init`/);
  assert.match(readme, /tenant isolation, API-key hashing, OAuth and capture authorization are preserved/);
  assert.match(readme, /Do not enter API keys or OAuth client secrets in a chat/);
  assert.match(quickstart, /ALFRED_MEMORY_BASE_URL=http:\/\/127\.0\.0\.1:3000/);
  assert.match(quickstart, /Authorization: Bearer \$ALFRED_MEMORY_API_KEY/);
  assert.match(quickstart, /Existing tenants, API keys, OAuth, MCP, and Postgres backends remain supported/);
  assert.match(quickstart, /Wildcard binds, arbitrary hostnames, and hosting modes other than `local` are rejected/);
  assert.match(quickstart, /Cloud ChatGPT Actions and Google AI Studio cannot reach this loopback service/);
  assert.match(quickstart, /Keep credentials out of chat and source control/);
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


test("GPT and generic Orchestrator instructions preserve grounded capture safeguards", () => {
  const gpt = JSON.parse(readFileSync(resolve(root, ".ai/gpt/alfred-memory-gpt.json"), "utf8")).system_prompt;
  const orchestrator = readFileSync(resolve(root, ".ai/agents/orchestrator.md"), "utf8");
  for (const source of [gpt, orchestrator]) {
    const instructions = source.replace(/\s+/g, " ");
    for (const safeguard of [
      /without waiting|do not wait/i,
      /context\.evidence/, /context\.origin/, /user/, /verified/,
      /exact excerpt/, /2,000 characters/, /1,000 characters/,
      /Do not send a full transcript/i,
      /do not remember this/i, /no guardes esto/i, /auto-save opt-outs/i,
      /context\.persistenceDisabled: true/,
      /secrets.*sensitive personal data proactively/i,
      /tool authorization requirements/i,
      /created/, /duplicate/, /skipped/,
      /do not claim a new save/i,
      /never bypass a skipped or failed capture/i,
      /delet(?:e|ion).*confirmation/i
    ]) assert.match(instructions, safeguard);
  }
  assert.match(gpt, /captureMemory/);
  const generic = orchestrator.replace(/\s+/g, " ");
  assert.match(generic, /explicitly configured persistence capability is available and authorized/i);
  assert.match(generic, /guarded capture operation and documented contract/i);
  assert.match(generic, /\{ candidate, context \}.*explicit equivalent mapping/);
  assert.match(generic, /Without that capability, continue ordinary work without persistence/i);
  assert.match(generic, /cannot preserve these safeguards, skip proactive persistence/i);
  assert.match(generic, /Do not connect accounts, change the storage destination, or broaden permissions/i);
  assert.match(generic, /Report write failures honestly; never claim unavailable memory was saved or silently use a different store/i);
  assert.match(generic, /Never bypass a skipped or failed capture through an unguarded create operation/i);
  assert.doesNotMatch(generic, /captureMemory|memory_capture|memory_create|Alfred Memory/);
});

test("Memory capture mapping is documented only as an explicitly configured optional connection", () => {
  const contract = readFileSync(resolve(root, "docs/product-capabilities.md"), "utf8").replace(/\s+/g, " ");
  assert.match(contract, /explicitly configured Alfred Memory MCP connection/i);
  assert.match(contract, /`memory_capture` \(client equivalent `captureMemory`\) with `\{ candidate, context \}`/);
  assert.match(contract, /exact minimal excerpt of evidence.*origin `user` or `verified`/);
  assert.match(contract, /size, privacy, and opt-out rules/);
  assert.match(contract, /skipped or failed capture must not be bypassed with `memory_create`/i);
  assert.match(contract, /Other persistence providers must honor the same safeguards/);
  assert.match(contract, /Without an authorized persistence capability, ordinary agent work continues/);
  assert.match(contract, /That caller supplies endpoint, credentials, and scope/);
  assert.match(contract, /Selecting several setup components does not configure MCP or session adapters/);
});
