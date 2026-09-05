import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { createUserService } from "../../memory/src/index.js";
import { createSqliteRegistryStore } from "../src/registry/sqlite-registry-store.js";
import {
  createOAuthService,
  hashOAuthSecret,
  loadOAuthConfig,
  OAuthConfigError
} from "../src/oauth/oauth-service.js";
import { createOAuthRouter } from "../src/oauth/oauth-router.js";
import { createOpenapiRouter } from "../src/openapi-router.js";

const CLIENT_ID = "alfred-chatgpt";
const CLIENT_SECRET = "test-secret-with-at-least-thirty-two-characters";
const REDIRECT_URI = "https://chatgpt.com/aip/g-test/oauth/callback";
const MCP_RESOURCE = "https://alfred-labs-memory.fly.dev/mcp";
const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..", "..");

function config(overrides = {}) {
  return {
    enabled: true,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    publicUrl: "https://alfred-labs-memory.fly.dev",
    mcpResource: MCP_RESOURCE,
    redirectUris: [REDIRECT_URI],
    authorizationCodeTtlSeconds: 300,
    accessTokenTtlSeconds: 3600,
    refreshTokenTtlSeconds: 2_592_000,
    ...overrides
  };
}

async function fixture({
  now = Date.parse("2026-09-02T12:00:00.000Z"),
  oauthConfig = config()
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), "alfred-oauth-"));
  const registry = await createSqliteRegistryStore({ dbPath: join(dir, "registry.sqlite") });
  const tenant = await registry.tenants.createTenant({
    kind: "coding_agent_only",
    storage_backend: "sqlite",
    db_path: join(dir, "memory.sqlite"),
    display_name: "OAuth test"
  });
  const userService = createUserService({ store: registry.users });
  const { apiKey } = await userService.provisionApiKey({ tenant_id: tenant.id, label: "oauth-test" });
  let clock = now;
  const oauthService = createOAuthService({
    config: oauthConfig, registry, userService, now: () => clock
  });
  return {
    dir, registry, tenant, userService, apiKey, oauthService,
    advance(ms) { clock += ms; },
    close() { registry.close(); rmSync(dir, { recursive: true, force: true }); }
  };
}

function authorizationInput(apiKey, overrides = {}) {
  return {
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    state: "chatgpt-state",
    scope: "memory:read memory:write",
    api_key: apiKey,
    ...overrides
  };
}

async function issueCode(fx, overrides = {}) {
  const result = await fx.oauthService.authorize(authorizationInput(fx.apiKey, overrides));
  const redirect = new URL(result.redirect_uri);
  return { code: redirect.searchParams.get("code"), redirect };
}

async function exchangeCode(fx, code) {
  return fx.oauthService.exchangeToken({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code
  });
}

function fakeReq({ method = "GET", url = "/", headers = {}, body = "" } = {}) {
  const chunks = body ? [Buffer.from(body)] : [];
  return {
    method, url, headers,
    [Symbol.asyncIterator]() {
      let index = 0;
      return { next: async () => index < chunks.length ? { value: chunks[index++], done: false } : { done: true } };
    }
  };
}

function fakeRes() {
  return {
    statusCode: 200, headers: {}, chunks: [],
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status, headers = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    },
    end(chunk = "") { if (chunk) this.chunks.push(String(chunk)); this.body = this.chunks.join(""); }
  };
}

test("OAuth configuration is disabled when absent and rejects partial configuration", () => {
  assert.deepEqual(loadOAuthConfig({}), { enabled: false });
  assert.throws(
    () => loadOAuthConfig({ ALFRED_OAUTH_CLIENT_ID: CLIENT_ID }),
    (err) => err instanceof OAuthConfigError && /incomplete/.test(err.message)
  );
});

test("OAuth configuration validates HTTPS URLs and exact redirect entries", () => {
  const parsed = loadOAuthConfig({
    ALFRED_OAUTH_CLIENT_ID: CLIENT_ID,
    ALFRED_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
    ALFRED_OAUTH_REDIRECT_URIS: `${REDIRECT_URI}, ${REDIRECT_URI}`,
    ALFRED_PUBLIC_URL: "https://alfred-labs-memory.fly.dev/"
  });
  assert.equal(parsed.publicUrl, "https://alfred-labs-memory.fly.dev");
  assert.equal(parsed.mcpResource, MCP_RESOURCE);
  assert.deepEqual(parsed.redirectUris, [REDIRECT_URI]);
  assert.throws(() => loadOAuthConfig({
    ALFRED_OAUTH_CLIENT_ID: CLIENT_ID,
    ALFRED_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
    ALFRED_OAUTH_REDIRECT_URIS: "http://example.com/callback",
    ALFRED_PUBLIC_URL: "https://alfred.example.com"
  }), /HTTPS/);
});

test("MCP authorization requires PKCE S256 and binds issued tokens to the resource", async () => {
  const fx = await fixture();
  const verifier = "alfred-mcp-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  try {
    assert.throws(
      () => fx.oauthService.validateAuthorizationRequest(authorizationInput(fx.apiKey, { resource: MCP_RESOURCE })),
      /PKCE/
    );
    assert.throws(
      () => fx.oauthService.validateAuthorizationRequest(authorizationInput(fx.apiKey, {
        resource: "https://attacker.example/mcp",
        code_challenge: challenge,
        code_challenge_method: "S256"
      })),
      /resource is not supported/
    );

    const { code } = await issueCode(fx, {
      resource: MCP_RESOURCE,
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    const stored = fx.registry.rawHandle.prepare(`
      SELECT resource, code_challenge, code_challenge_method
        FROM oauth_authorization_codes
    `).get();
    assert.equal(stored.resource, MCP_RESOURCE);
    assert.equal(stored.code_challenge, challenge);
    assert.equal(stored.code_challenge_method, "S256");
    assert.equal(JSON.stringify(stored).includes(verifier), false);

    await assert.rejects(() => fx.oauthService.exchangeToken({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
      resource: MCP_RESOURCE,
      code_verifier: `${verifier}wrong`
    }), /PKCE verification failed/);

    const tokens = await fx.oauthService.exchangeToken({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
      resource: MCP_RESOURCE,
      code_verifier: verifier
    });
    const resolved = await fx.oauthService.resolveAccessToken(tokens.access_token, { resource: MCP_RESOURCE });
    assert.equal(resolved.tenant_id, fx.tenant.id);
    assert.equal(resolved.resource, MCP_RESOURCE);
    assert.equal(
      await fx.oauthService.resolveAccessToken(tokens.access_token, { resource: "https://attacker.example/mcp" }),
      null
    );

    await assert.rejects(() => fx.oauthService.exchangeToken({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokens.refresh_token
    }), /resource does not match/);
    const refreshed = await fx.oauthService.exchangeToken({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      resource: MCP_RESOURCE
    });
    assert.equal(
      (await fx.oauthService.resolveAccessToken(refreshed.access_token, { resource: MCP_RESOURCE })).resource,
      MCP_RESOURCE
    );
  } finally { fx.close(); }
});

test("resource-bound MCP grants support a PKCE public client without a secret", async () => {
  const fx = await fixture();
  const verifier = "alfred-public-client-verifier-abcdefghijklmnopqrstuvwxyz0123456789";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  try {
    const { code } = await issueCode(fx, {
      resource: MCP_RESOURCE,
      code_challenge: challenge,
      code_challenge_method: "S256"
    });
    const tokens = await fx.oauthService.exchangeToken({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code,
      resource: MCP_RESOURCE,
      code_verifier: verifier
    });
    assert.match(tokens.access_token, /^alo_/);
    assert.match(tokens.refresh_token, /^alr_/);

    const rotated = await fx.oauthService.exchangeToken({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: tokens.refresh_token,
      resource: MCP_RESOURCE
    });
    assert.match(rotated.access_token, /^alo_/);
    assert.notEqual(rotated.refresh_token, tokens.refresh_token);
  } finally {
    fx.close();
  }
});

test("legacy non-PKCE grants still require confidential client authentication", async () => {
  const fx = await fixture();
  try {
    const { code } = await issueCode(fx);
    await assert.rejects(() => fx.oauthService.exchangeToken({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code
    }), /Public clients require a resource-bound PKCE authorization code/);
  } finally {
    fx.close();
  }
});

test("authorization validates state, client, redirect URI, and scopes", async () => {
  const fx = await fixture();
  try {
    assert.throws(() => fx.oauthService.validateAuthorizationRequest(authorizationInput(fx.apiKey, { state: "" })), /state is required/);
    assert.throws(() => fx.oauthService.validateAuthorizationRequest(authorizationInput(fx.apiKey, { client_id: "other" })), /Unknown OAuth client/);
    assert.throws(() => fx.oauthService.validateAuthorizationRequest(authorizationInput(fx.apiKey, { redirect_uri: "https://evil.example/cb" })), /not allowed/);
    assert.throws(() => fx.oauthService.validateAuthorizationRequest(authorizationInput(fx.apiKey, { scope: "admin" })), /not supported/);
  } finally { fx.close(); }
});

test("authorization code roundtrip returns state and stores only a hash", async () => {
  const fx = await fixture();
  try {
    const { code, redirect } = await issueCode(fx);
    assert.ok(code.startsWith("alc_"));
    assert.equal(redirect.searchParams.get("state"), "chatgpt-state");
    const row = fx.registry.rawHandle.prepare("SELECT code_hash FROM oauth_authorization_codes").get();
    assert.equal(row.code_hash, hashOAuthSecret(code));
    assert.equal(JSON.stringify(row).includes(code), false);
  } finally { fx.close(); }
});

test("authorization rejects an invalid Alfred API key", async () => {
  const fx = await fixture();
  try {
    await assert.rejects(() => fx.oauthService.authorize(authorizationInput("alk_invalid")), /invalid or revoked/);
    assert.equal(fx.registry.rawHandle.prepare("SELECT COUNT(*) AS c FROM oauth_authorization_codes").get().c, 0);
  } finally { fx.close(); }
});

test("authorization codes are single-use and access tokens resolve the tenant", async () => {
  const fx = await fixture();
  try {
    const { code } = await issueCode(fx);
    const tokens = await exchangeCode(fx, code);
    assert.ok(tokens.access_token.startsWith("alo_"));
    assert.ok(tokens.refresh_token.startsWith("alr_"));
    assert.equal(tokens.token_type, "bearer");
    const resolved = await fx.oauthService.resolveAccessToken(tokens.access_token);
    assert.equal(resolved.tenant_id, fx.tenant.id);
    assert.deepEqual(resolved.scopes, ["memory:read", "memory:write"]);
    await assert.rejects(() => exchangeCode(fx, code), /already used/);
    const stored = fx.registry.rawHandle.prepare("SELECT token_hash FROM oauth_tokens ORDER BY token_type").all();
    assert.equal(stored.some((row) => row.token_hash === tokens.access_token || row.token_hash === tokens.refresh_token), false);
  } finally { fx.close(); }
});

test("expired authorization code and invalid client secret fail closed", async () => {
  const fx = await fixture();
  try {
    const { code } = await issueCode(fx);
    await assert.rejects(() => fx.oauthService.exchangeToken({
      grant_type: "authorization_code", client_id: CLIENT_ID, client_secret: "wrong",
      redirect_uri: REDIRECT_URI, code
    }), /Client authentication failed/);
    fx.advance(301_000);
    await assert.rejects(() => exchangeCode(fx, code), /expired/);
  } finally { fx.close(); }
});

test("refresh tokens rotate and reuse revokes the whole token family", async () => {
  const fx = await fixture();
  try {
    const { code } = await issueCode(fx);
    const first = await exchangeCode(fx, code);
    const second = await fx.oauthService.exchangeToken({
      grant_type: "refresh_token", client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: first.refresh_token
    });
    assert.notEqual(second.refresh_token, first.refresh_token);
    assert.ok(await fx.oauthService.resolveAccessToken(second.access_token));
    await assert.rejects(() => fx.oauthService.exchangeToken({
      grant_type: "refresh_token", client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: first.refresh_token
    }), /reuse was detected/);
    assert.equal(await fx.oauthService.resolveAccessToken(second.access_token), null);
  } finally { fx.close(); }
});

test("OAuth trace records outcomes without credentials and with zero provider calls", async () => {
  const fx = await fixture();
  try {
    const { code } = await issueCode(fx);
    const tokens = await exchangeCode(fx, code);
    const rows = fx.registry.rawHandle.prepare("SELECT event, payload FROM tenant_trace ORDER BY created_at").all();
    assert.deepEqual(rows.map((row) => row.event), ["oauth.authorization_code_issued", "oauth.authorization_code_exchanged"]);
    const serialized = JSON.stringify(rows);
    assert.equal(serialized.includes(code), false);
    assert.equal(serialized.includes(tokens.access_token), false);
    assert.equal(serialized.includes(fx.apiKey), false);
    assert.ok(rows.every((row) => JSON.parse(row.payload).provider_calls === 0));
  } finally { fx.close(); }
});

test("OAuth router renders consent and exchanges form-encoded tokens", async () => {
  const fx = await fixture({
    oauthConfig: config({
      redirectUris: [REDIRECT_URI, "https://chat.openai.com/aip/g-test/oauth/callback"]
    })
  });
  try {
    const router = createOAuthRouter({ oauthService: fx.oauthService });
    const query = new URLSearchParams(authorizationInput(fx.apiKey));
    query.delete("api_key");
    const consent = fakeRes();
    await router(fakeReq({ url: `/oauth/authorize?${query}` }), consent);
    assert.equal(consent.statusCode, 200);
    assert.match(consent.body, /Conectar Alfred Memory/);
    assert.doesNotMatch(consent.body, new RegExp(fx.apiKey));
    assert.equal(
      consent.headers["content-security-policy"],
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://chatgpt.com; base-uri 'none'; frame-ancestors 'none'"
    );
    assert.doesNotMatch(
      consent.headers["content-security-policy"],
      /g-test|oauth\/callback|chat\.openai\.com|evil\.example/
    );

    const denied = fakeRes();
    await router(fakeReq({
      method: "POST", url: "/oauth/authorize",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(authorizationInput("alk_invalid")).toString()
    }), denied);
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.headers["content-security-policy"], consent.headers["content-security-policy"]);

    const authorize = fakeRes();
    await router(fakeReq({
      method: "POST", url: "/oauth/authorize",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(authorizationInput(fx.apiKey)).toString()
    }), authorize);
    assert.equal(authorize.statusCode, 302);
    const callback = new URL(authorize.headers.location);
    assert.equal(`${callback.origin}${callback.pathname}`, REDIRECT_URI);
    assert.equal(callback.searchParams.get("state"), "chatgpt-state");
    assert.deepEqual([...callback.searchParams.keys()].sort(), ["code", "state"]);
    const code = callback.searchParams.get("code");
    assert.ok(code?.startsWith("alc_"));

    const token = fakeRes();
    await router(fakeReq({
      method: "POST", url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI, code
      }).toString()
    }), token);
    assert.equal(token.statusCode, 200);
    assert.ok(JSON.parse(token.body).access_token.startsWith("alo_"));
    assert.equal(token.headers["cache-control"], "no-store");
  } finally { fx.close(); }
});

test("OAuth router does not reflect a rejected redirect origin into form-action CSP", async () => {
  const fx = await fixture();
  try {
    const router = createOAuthRouter({ oauthService: fx.oauthService });
    const query = new URLSearchParams(authorizationInput(fx.apiKey, {
      redirect_uri: "https://evil.example/oauth/callback"
    }));
    query.delete("api_key");
    const response = fakeRes();

    await router(fakeReq({ url: `/oauth/authorize?${query}` }), response);

    assert.equal(response.statusCode, 400);
    assert.equal(
      response.headers["content-security-policy"],
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
    );
    assert.doesNotMatch(response.headers["content-security-policy"], /evil\.example|chatgpt\.com/);
  } finally { fx.close(); }
});

test("OAuth router publishes authorization-server metadata for MCP clients", async () => {
  const fx = await fixture();
  try {
    const router = createOAuthRouter({ oauthService: fx.oauthService });
    const res = fakeRes();
    await router(fakeReq({ url: "/.well-known/oauth-authorization-server" }), res);

    assert.equal(res.statusCode, 200);
    const metadata = JSON.parse(res.body);
    assert.equal(metadata.issuer, "https://alfred-labs-memory.fly.dev");
    assert.equal(metadata.authorization_endpoint, "https://alfred-labs-memory.fly.dev/oauth/authorize");
    assert.equal(metadata.token_endpoint, "https://alfred-labs-memory.fly.dev/oauth/token");
    assert.deepEqual(metadata.code_challenge_methods_supported, ["S256"]);
    assert.deepEqual(metadata.token_endpoint_auth_methods_supported, ["none", "client_secret_basic", "client_secret_post"]);
  } finally { fx.close(); }
});

test("OAuth token endpoint accepts HTTP Basic client authentication", async () => {
  const fx = await fixture();
  try {
    const { code } = await issueCode(fx);
    const router = createOAuthRouter({ oauthService: fx.oauthService });
    const token = fakeRes();
    await router(fakeReq({
      method: "POST", url: "/oauth/token",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`
      },
      body: new URLSearchParams({
        grant_type: "authorization_code", redirect_uri: REDIRECT_URI, code
      }).toString()
    }), token);
    assert.equal(token.statusCode, 200);
    assert.ok(JSON.parse(token.body).access_token.startsWith("alo_"));
  } finally { fx.close(); }
});

test("OAuth routes fail closed when server configuration is absent", async () => {
  const router = createOAuthRouter();
  const response = fakeRes();
  await router(fakeReq({ url: "/oauth/authorize" }), response);
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).error, "temporarily_unavailable");
});

test("OpenAPI document is served publicly from the memory server", async () => {
  const fx = await fixture();
  try {
    const router = createOpenapiRouter({
      userService: fx.userService,
      getMemoryService: async () => ({}),
      projectRoot: PROJECT_ROOT,
      requireAuth: true
    });
    const response = fakeRes();
    await router(fakeReq({ url: "/openapi.yaml" }), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/yaml; charset=utf-8");
    assert.match(response.body, /^openapi: 3\.1\.0/m);
  } finally { fx.close(); }
});

test("OpenAPI router accepts OAuth read scope and rejects a write", async () => {
  const fx = await fixture();
  try {
    const { code } = await issueCode(fx, { scope: "memory:read" });
    const tokens = await exchangeCode(fx, code);
    const memoryService = {
      async listMemories() { return { items: [], pagination: { limit: 50, offset: 0, total: 0 } }; },
      async createMemory() { throw new Error("must not execute"); }
    };
    const router = createOpenapiRouter({
      userService: fx.userService,
      getMemoryService: async () => memoryService,
      projectRoot: PROJECT_ROOT,
      oauthService: fx.oauthService,
      requireAuth: true
    });
    const headers = { authorization: `Bearer ${tokens.access_token}` };
    const read = fakeRes();
    await router(fakeReq({ method: "GET", url: "/memories", headers }), read);
    assert.equal(read.statusCode, 200);
    const write = fakeRes();
    await router(fakeReq({ method: "POST", url: "/memories", headers, body: "{}" }), write);
    assert.equal(write.statusCode, 403);
    assert.match(write.headers["www-authenticate"], /memory:write/);
  } finally { fx.close(); }
});
