import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createUserService,
  createInMemoryUserStore,
  verifyApiKey,
  normalizeProvisionUserInput
} from "../src/index.js";

const stubTenant = {
  id: "usr_t_stub",
  kind: "coding_agent_only",
  storage_backend: "sqlite",
  db_path: "/tmp/stub.sqlite"
};

function makeStore(initialKeys = []) {
  return createInMemoryUserStore({
    initialTenants: [stubTenant],
    initialKeys
  });
}

function makeService(initialKeys = []) {
  const traces = [];
  const store = makeStore(initialKeys);
  let idSeq = 0;
  const service = createUserService({
    store,
    trace: (e) => traces.push(e),
    now: () => new Date("2026-06-29T00:00:00.000Z"),
    idGenerator: () => `key_test_${++idSeq}`,
    apiKeyGenerator: () => `alk_${Math.random().toString(36).slice(2, 18).padEnd(16, "x").slice(0, 16)}`
  });
  return { service, store, traces };
}

test("provisionApiKey returns a key with visible prefix and a scrypt hash", async () => {
  const { service } = makeService();
  const result = await service.provisionApiKey({ tenant_id: stubTenant.id, label: "laptop" });
  assert.ok(result.apiKey.startsWith("alk_"));
  assert.ok(result.key.key_prefix.startsWith("alk_"));
  assert.notEqual(result.key.key_prefix, result.apiKey, "prefix must not be the full key");
  assert.match(result.key.key_hash, /^scrypt\$/);
  assert.equal(result.key.tenant_id, stubTenant.id);
  assert.equal(result.key.revoked_at, null);
  assert.equal(result.key.label, "laptop");
});

test("resolveApiKey returns tenant_id for a valid key", async () => {
  const { service } = makeService();
  const { apiKey } = await service.provisionApiKey({ tenant_id: stubTenant.id });
  const resolved = await service.resolveApiKey(apiKey);
  assert.ok(resolved);
  assert.equal(resolved.tenant_id, stubTenant.id);
});

test("resolveApiKey returns null for wrong key", async () => {
  const { service } = makeService();
  const { apiKey } = await service.provisionApiKey({ tenant_id: stubTenant.id });
  const tampered = apiKey.slice(0, -2) + (apiKey.endsWith("a") ? "bb" : "aa");
  const resolved = await service.resolveApiKey(tampered);
  assert.equal(resolved, null);
});

test("resolveApiKey returns null for keys with wrong prefix", async () => {
  const { service } = makeService();
  const resolved = await service.resolveApiKey("zzz_invalid");
  assert.equal(resolved, null);
});

test("resolveApiKey returns null for revoked keys", async () => {
  const { service } = makeService();
  const { key, apiKey } = await service.provisionApiKey({ tenant_id: stubTenant.id });
  await service.revokeApiKey(key.id, { reason: "rotation" });
  const resolved = await service.resolveApiKey(apiKey);
  assert.equal(resolved, null);
});

test("rotateApiKey revokes prior active keys and returns a fresh one", async () => {
  const { service, traces } = makeService();
  await service.provisionApiKey({ tenant_id: stubTenant.id });
  await service.provisionApiKey({ tenant_id: stubTenant.id });
  const rotated = await service.rotateApiKey({ tenant_id: stubTenant.id });
  const remainingActive = await service.listApiKeys(stubTenant.id, { includeRevoked: false });
  assert.equal(remainingActive.length, 1);
  assert.equal(remainingActive[0].id, rotated.key.id);
  const allKeys = await service.listApiKeys(stubTenant.id, { includeRevoked: true });
  assert.equal(allKeys.length, 3);
  const rotateEvent = traces.find((e) => e.event === "apikey.rotate");
  assert.ok(rotateEvent);
  assert.equal(rotateEvent.revoked, 2);
});

test("resolveApiKey after rotation: old key resolves to nothing, new key works", async () => {
  const { service } = makeService();
  const first = await service.provisionApiKey({ tenant_id: stubTenant.id });
  const rotated = await service.rotateApiKey({ tenant_id: stubTenant.id });
  assert.equal(await service.resolveApiKey(first.apiKey), null);
  const resolved = await service.resolveApiKey(rotated.apiKey);
  assert.ok(resolved);
  assert.equal(resolved.tenant_id, stubTenant.id);
});

test("revokeApiKey emits a trace event and is idempotent", async () => {
  const { service, traces } = makeService();
  const { key } = await service.provisionApiKey({ tenant_id: stubTenant.id });
  const r1 = await service.revokeApiKey(key.id, { reason: "lost laptop" });
  assert.equal(r1.already_revoked, false);
  const r2 = await service.revokeApiKey(key.id, { reason: "double tap" });
  assert.equal(r2.already_revoked, true);
  assert.ok(traces.find((t) => t.event === "apikey.revoke"));
});

test("deleteKeysForTenant cascades all keys for a tenant", async () => {
  const { service } = makeService();
  await service.provisionApiKey({ tenant_id: stubTenant.id });
  await service.provisionApiKey({ tenant_id: stubTenant.id });
  const result = await service.deleteKeysForTenant(stubTenant.id);
  assert.equal(result.deleted, 2);
  const keys = await service.listApiKeys(stubTenant.id, { includeRevoked: true });
  assert.equal(keys.length, 0);
});

test("provisionApiKey rejects unknown tenant", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.provisionApiKey({ tenant_id: "usr_t_unknown" }),
    (err) => err.name === "UserNotFoundError"
  );
});

test("provisionApiKey rejects invalid algorithm", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.provisionApiKey({ tenant_id: stubTenant.id, algorithm: "made_up" }),
    (err) => err.name === "UserValidationError"
  );
});

test("provisionApiKey rejects empty body", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.provisionApiKey(null),
    (err) => err.name === "UserValidationError"
  );
});

test("verifyApiKey accepts scrypt and rejects garbled hash format", () => {
  assert.equal(verifyApiKey("scrypt$1$2$3$zz$aa", "scrypt", "anything"), false);
  assert.equal(verifyApiKey("not-a-hash", "scrypt", "anything"), false);
  assert.equal(verifyApiKey("sha256$abcdef", "sha256", "anything"), false);
  const realHash = "scrypt$32768$8$1$00$00";
  assert.equal(verifyApiKey(realHash, "scrypt", "x"), false);
});

test("normalizeProvisionUserInput rejects missing tenant_id", () => {
  const r = normalizeProvisionUserInput({});
  assert.equal(r.valid, false);
});

test("normalizeProvisionUserInput rejects non-object", () => {
  const r = normalizeProvisionUserInput(null);
  assert.equal(r.valid, false);
});

test("listApiKeys with active_only=false includes revoked keys", async () => {
  const { service } = makeService();
  const { key } = await service.provisionApiKey({ tenant_id: stubTenant.id });
  await service.revokeApiKey(key.id);
  const active = await service.listApiKeys(stubTenant.id, { includeRevoked: false });
  const all = await service.listApiKeys(stubTenant.id, { includeRevoked: true });
  assert.equal(active.length, 0);
  assert.equal(all.length, 1);
});

test("provisionApiKey stamps last_used_at on resolve", async () => {
  const { service } = makeService();
  const { apiKey, key } = await service.provisionApiKey({ tenant_id: stubTenant.id });
  assert.equal(key.last_used_at, null);
  await service.resolveApiKey(apiKey);
  const all = await service.listApiKeys(stubTenant.id, { includeRevoked: true });
  assert.notEqual(all[0].last_used_at, null);
});
