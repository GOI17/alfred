import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createRecovery } from "../src/bootstrap/recovery.js";
import {
  buildOAuthRecoveryHref,
  createRecoveryContinuationPolicy,
  RECOVERY_FALLBACK_URL
} from "../src/bootstrap/recovery-continuation.js";
import { createConsoleRouter } from "../src/console-router.js";
import { createOAuthRouter } from "../src/oauth/oauth-router.js";
import { createSqliteRegistryStore } from "../src/registry/sqlite-registry-store.js";

const CALLBACK = "https://chatgpt.example/aip/g-test/oauth/callback";
const RECOVERY_CREDENTIAL = "synthetic-recovery-credential";
const RECOVERED_KEY = "synthetic-recovered-api-key";

function oauthService() {
  return {
    validateAuthorizationRequest(input) {
      if (input.response_type !== "code") throw new Error("response type");
      if (input.client_id !== "alfred-chatgpt") throw new Error("client");
      if (input.redirect_uri !== CALLBACK) throw new Error("callback");
      if (!input.state || input.state.length > 2048) throw new Error("state");
      if (input.scope !== "memory:read memory:write") throw new Error("scope");
      return {
        response_type: "code",
        client_id: "alfred-chatgpt",
        redirect_uri: CALLBACK,
        state: input.state,
        scope: "memory:read memory:write"
      };
    }
  };
}

function authorizationPath() {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: "alfred-chatgpt",
    redirect_uri: CALLBACK,
    state: "synthetic-state",
    scope: "memory:read memory:write"
  });
  return `/oauth/authorize?${query}`;
}

function responseRecorder() {
  return {
    headers: {},
    body: "",
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
    },
    end(chunk = "") { this.body += chunk; }
  };
}

function request({ method = "GET", url = "/", headers = {}, body = null } = {}) {
  const payload = body === null ? "" : (typeof body === "string" ? body : JSON.stringify(body));
  return {
    method,
    url,
    headers,
    socket: { remoteAddress: "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      if (payload) yield Buffer.from(payload);
    }
  };
}

function recoveryRegistry(row, traces = []) {
  return {
    recordBootstrapAttempt: async () => ({}),
    countBootstrapAttempts: async () => 0,
    oldestBootstrapAttemptInWindow: async () => null,
    recoveries: {
      findLatestVerificationForEmail: async () => ({ tenant_id: "tenant-test" }),
      createRecovery: async (input) => { Object.assign(row, { id: "recovery-test", ...input }); return { id: row.id }; },
      findRecoveryByToken: async (value) => value === RECOVERY_CREDENTIAL ? row : null,
      findActiveKeyForTenant: async () => ({ id: "old-key", tenant_id: "tenant-test" }),
      revokeApiKey: async () => {},
      markRecoveryUsed: async () => { row.used_at = new Date().toISOString(); }
    },
    oauth: {
      recordTrace: async (event) => { traces.push(event); return { id: "trace-test" }; }
    }
  };
}

function recoverySender(sent = []) {
  return {
    isValidEmail: (value) => typeof value === "string" && value.includes("@"),
    checkReadiness: async () => ({ ready: true }),
    generateToken: () => RECOVERY_CREDENTIAL,
    send: async (message) => { sent.push(message); return { sent: true }; }
  };
}

function recoveredUserService() {
  return {
    provisionApiKey: async () => ({
      apiKey: RECOVERED_KEY,
      key: { id: "new-key", key_prefix: "synthetic-prefix" }
    })
  };
}

test("recovery continuation accepts only one canonical validated OAuth request", () => {
  const policy = createRecoveryContinuationPolicy({ oauthService: oauthService() });
  const accepted = policy.normalize(authorizationPath());
  assert.equal(accepted.kind, "oauth");
  assert.equal(accepted.url, authorizationPath());

  const hostile = [
    "https://attacker.example/collect",
    "//attacker.example/collect",
    "/console/",
    authorizationPath().replace("/oauth/authorize", "/console/../oauth/authorize"),
    `${authorizationPath()}&next=https%3A%2F%2Fattacker.example`,
    `${authorizationPath()}&state=duplicate`,
    authorizationPath().replace(encodeURIComponent(CALLBACK), encodeURIComponent("https://attacker.example/callback")),
    `${authorizationPath()}#fragment`
  ];
  for (const value of hostile) assert.throws(() => policy.normalize(value));
});

test("OAuth recovery persists only the canonical path and emits redacted traces", async () => {
  const row = {};
  const sent = [];
  const traces = [];
  const recovery = createRecovery({
    registry: recoveryRegistry(row),
    userService: recoveredUserService(),
    emailSender: recoverySender(sent),
    continuationPolicy: createRecoveryContinuationPolicy({ oauthService: oauthService() }),
    trace: async (event) => { traces.push(event); },
    baseUrl: "https://alfred.example"
  });

  const requested = await recovery.requestRecovery({
    ip: "127.0.0.1",
    email: "person@example.com",
    continueTo: authorizationPath()
  });
  assert.equal(row.continuation_path, authorizationPath());
  assert.equal(new URL(requested.link).searchParams.size, 1);
  assert.doesNotMatch(sent[0].text, /continue_to|synthetic-state|chatgpt\.example/);

  const consumed = await recovery.consumeRecovery({ token: RECOVERY_CREDENTIAL });
  assert.equal(consumed.continue_url, authorizationPath());
  assert.equal(consumed.continue_label, "Continue with Alfred");
  assert.deepEqual(traces.map((entry) => entry.event), ["recovery.requested", "recovery.consumed"]);
  const traceText = JSON.stringify(traces);
  for (const forbidden of ["person@example.com", RECOVERY_CREDENTIAL, RECOVERED_KEY, "synthetic-state", CALLBACK]) {
    assert.equal(traceText.includes(forbidden), false);
  }
  assert.ok(traces.every((entry) => entry.payload.provider_calls === 0));
});

test("recovery rejects hostile requested continuation and safely resolves corrupt stored data", async () => {
  const row = {};
  const recovery = createRecovery({
    registry: recoveryRegistry(row),
    userService: recoveredUserService(),
    emailSender: recoverySender(),
    continuationPolicy: createRecoveryContinuationPolicy({ oauthService: oauthService() })
  });
  await assert.rejects(
    recovery.requestRecovery({ ip: "127.0.0.1", email: "person@example.com", continueTo: "https://attacker.example" }),
    (error) => error.code === "validation_error" && error.details[0].field === "continue_to"
  );

  const router = createConsoleRouter({
    userService: recoveredUserService(),
    tenantService: {},
    config: {},
    consoleDirOverride: "",
    registry: recoveryRegistry(row),
    emailSender: recoverySender(),
    oauthService: oauthService()
  });
  const rejected = responseRecorder();
  await router(request({
    method: "POST",
    url: "/console/api/recover",
    body: { email: "person@example.com", continue_to: "https://attacker.example" }
  }), rejected);
  assert.equal(rejected.statusCode, 400);
  assert.equal(JSON.parse(rejected.body).error.code, "validation_error");

  Object.assign(row, {
    id: "recovery-test",
    tenant_id: "tenant-test",
    email: "person@example.com",
    token: RECOVERY_CREDENTIAL,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    continuation_path: "https://attacker.example"
  });
  const result = await recovery.consumeRecovery({ token: RECOVERY_CREDENTIAL });
  assert.equal(result.continuation_kind, "console");
  assert.equal(result.continue_url, RECOVERY_FALLBACK_URL);
});

test("OAuth consent links to recovery with only the validated internal continuation", async () => {
  const service = oauthService();
  const router = createOAuthRouter({ oauthService: service });
  const res = responseRecorder();
  await router(request({ url: authorizationPath() }), res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /continue_to=/);
  assert.match(res.body, /Recupérala y continúa con Alfred/);
  assert.doesNotMatch(res.body, /attacker\.example/);

  const href = buildOAuthRecoveryHref(service.validateAuthorizationRequest(Object.fromEntries(new URL(authorizationPath(), "https://alfred.example").searchParams)));
  const nested = new URL(href, "https://alfred.example").searchParams.get("continue_to");
  assert.equal(nested, authorizationPath());
});

test("cross-origin console redirects preserve only one continuation value", async () => {
  const router = createConsoleRouter({
    userService: {},
    tenantService: {},
    config: {},
    consoleDirOverride: "",
    consoleUrl: "https://console.example/"
  });
  const path = authorizationPath();
  const res = responseRecorder();
  await router(request({ url: `/console/?${new URLSearchParams({ continue_to: path })}` }), res);
  assert.equal(res.statusCode, 302);
  assert.equal(new URL(res.headers.location).searchParams.get("continue_to"), path);

  const duplicate = responseRecorder();
  await router(request({ url: `/console/?continue_to=first&continue_to=second` }), duplicate);
  assert.equal(new URL(duplicate.headers.location).searchParams.has("continue_to"), false);
});

test("OAuth browser recovery gets a secured auto-return bridge and JSON remains compatible", async () => {
  const oauthRow = {
    id: "recovery-test",
    tenant_id: "tenant-test",
    email: "person@example.com",
    token: RECOVERY_CREDENTIAL,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    continuation_path: authorizationPath()
  };
  const oauthRouter = createConsoleRouter({
    userService: recoveredUserService(),
    tenantService: {},
    config: {},
    consoleDirOverride: "",
    registry: recoveryRegistry(oauthRow),
    emailSender: recoverySender(),
    oauthService: oauthService()
  });
  const browser = responseRecorder();
  await oauthRouter(request({
    url: `/console/api/recover?${new URLSearchParams({ token: RECOVERY_CREDENTIAL })}`,
    headers: { accept: "text/html,application/xhtml+xml" }
  }), browser);
  assert.equal(browser.statusCode, 200);
  assert.match(browser.headers["content-type"], /^text\/html/);
  assert.equal(browser.headers["cache-control"], "no-store");
  assert.equal(browser.headers["referrer-policy"], "no-referrer");
  assert.equal(browser.headers["x-frame-options"], "DENY");
  assert.match(browser.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.match(browser.body, /Continue with Alfred/);
  assert.match(browser.body, /http-equiv="refresh"/);
  assert.doesNotMatch(browser.body, /attacker\.example/);

  const refusedHtmlRow = { ...oauthRow, used_at: null };
  const refusedHtmlRouter = createConsoleRouter({
    userService: recoveredUserService(),
    tenantService: {},
    config: {},
    consoleDirOverride: "",
    registry: recoveryRegistry(refusedHtmlRow),
    emailSender: recoverySender(),
    oauthService: oauthService()
  });
  const refusedHtml = responseRecorder();
  await refusedHtmlRouter(request({
    url: `/console/api/recover?${new URLSearchParams({ token: RECOVERY_CREDENTIAL })}`,
    headers: { accept: "text/html;q=0, application/json" }
  }), refusedHtml);
  assert.match(refusedHtml.headers["content-type"], /^application\/json/);

  const directRow = {
    id: "direct-recovery",
    tenant_id: "tenant-test",
    email: "person@example.com",
    token: RECOVERY_CREDENTIAL,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    continuation_path: null
  };
  const directRouter = createConsoleRouter({
    userService: recoveredUserService(),
    tenantService: {},
    config: {},
    consoleDirOverride: "",
    registry: recoveryRegistry(directRow),
    emailSender: recoverySender(),
    oauthService: oauthService()
  });
  const machine = responseRecorder();
  await directRouter(request({
    url: `/console/api/recover?${new URLSearchParams({ token: RECOVERY_CREDENTIAL })}`,
    headers: { accept: "application/json" }
  }), machine);
  assert.equal(machine.statusCode, 200);
  assert.match(machine.headers["content-type"], /^application\/json/);
  const payload = JSON.parse(machine.body);
  assert.equal(payload.api_key, RECOVERED_KEY);
  assert.equal(payload.continue_url, RECOVERY_FALLBACK_URL);
  assert.equal(payload.continue_label, "Continue with Alfred");
});

test("existing SQLite recovery tables gain the continuation column", async () => {
  const dir = mkdtempSync(join(tmpdir(), "alfred-recovery-migration-"));
  const dbPath = join(dir, "registry.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE tenant_recoveries (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      new_key_id TEXT,
      old_key_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO tenant_recoveries
      (id, tenant_id, email, token, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "existing-recovery",
    "tenant-test",
    "person@example.com",
    RECOVERY_CREDENTIAL,
    new Date(Date.now() + 60_000).toISOString(),
    new Date().toISOString()
  );
  db.close();

  let store;
  try {
    store = await createSqliteRegistryStore({ dbPath });
    const columns = store.rawHandle.prepare("PRAGMA table_info(tenant_recoveries)").all();
    assert.ok(columns.some((column) => column.name === "continuation_path"));
    const existing = store.rawHandle.prepare("SELECT id FROM tenant_recoveries WHERE id = ?").get("existing-recovery");
    assert.equal(existing.id, "existing-recovery");
  } finally {
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
