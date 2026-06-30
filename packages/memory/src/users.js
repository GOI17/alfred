// UserService: domain layer for API key management.
//
// API keys authenticate agents against a tenant. Each key has:
//   * a prefix (e.g. "alk_7f3a...") stored in clear for indexed lookup
//   * a hash (scrypt by default) of the full key, never stored in clear
//   * a per-key algorithm column to support future migrations
//
// Provision creates a tenant row + an initial key, returning the key ONCE.
// Rotation revokes the old key and issues a new one.
// Revoke marks a key as revoked without issuing a replacement.
// Resolve by full key + prefix returns the tenant id or null.
// Delete cascades to keys.

import { createHash, randomBytes, scryptSync, timingSafeEqual, randomUUID } from "node:crypto";

export const API_KEY_PREFIX = "alk_";

const KEY_RANDOM_BYTES = 24; // 192 bits -> base64 ~32 chars
const SCRYPT_N = 1 << 14;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;

function generateApiKey() {
  return `${API_KEY_PREFIX}${randomBytes(KEY_RANDOM_BYTES).toString("base64url")}`;
}

function derivePrefix(apiKey) {
  // The visible prefix is the first 8 chars after "alk_" (~5-6 bytes base64url).
  // We deliberately make it short to avoid leaking entropy, but long enough
  // for a "find your key" UI.
  return apiKey.slice(0, API_KEY_PREFIX.length + 8);
}

function hashApiKey(algorithm, apiKey) {
  if (algorithm === "scrypt") {
    const salt = randomBytes(16);
    const derived = scryptSync(apiKey, salt, SCRYPT_KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
    return {
      hash: `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${derived.toString("hex")}`,
      algorithm: "scrypt"
    };
  }
  if (algorithm === "sha256") {
    return {
      hash: `sha256$${createHash("sha256").update(apiKey).digest("hex")}`,
      algorithm: "sha256"
    };
  }
  const error = new Error(`Unsupported algorithm '${algorithm}'.`);
  error.code = "validation_error";
  throw error;
}

function isPowerOfTwo(n) { return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0; }

export function verifyApiKey(storedHash, algorithm, candidate) {
  if (algorithm === "scrypt") {
    const parts = storedHash.split("$");
    if (parts.length !== 6) return false;
    const N = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!isPowerOfTwo(N)) return false;
    if (!Number.isInteger(r) || r < 1 || r > 1024) return false;
    if (!Number.isInteger(p) || p < 1 || p > 32) return false;
    const saltHex = parts[4];
    const expectedHex = parts[5];
    if (!/^[a-f0-9]+$/.test(saltHex) || !/^[a-f0-9]+$/.test(expectedHex)) return false;
    const salt = Buffer.from(saltHex, "hex");
    const expected = Buffer.from(expectedHex, "hex");
    let derived;
    try {
      derived = scryptSync(candidate, salt, expected.length, { N, r, p });
    } catch {
      return false;
    }
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }
  if (algorithm === "sha256") {
    const parts = storedHash.split("$");
    if (parts.length !== 2) return false;
    const expected = parts[1];
    const actual = createHash("sha256").update(candidate).digest("hex");
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
  }
  return false;
}

export class UserValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "UserValidationError";
    this.code = "validation_error";
    this.status = 400;
    this.details = details;
  }
}

export class UserNotFoundError extends Error {
  constructor(message = "User was not found.") {
    super(message);
    this.name = "UserNotFoundError";
    this.code = "not_found";
    this.status = 404;
  }
}

export class ApiKeyInvalidError extends Error {
  constructor(message = "API key is invalid.") {
    super(message);
    this.name = "ApiKeyInvalidError";
    this.code = "unauthorized";
    this.status = 401;
  }
}

export function normalizeProvisionUserInput(input) {
  const details = [];
  if (input === null || typeof input !== "object") {
    return { valid: false, details: [{ field: "body", message: "Request body must be a JSON object." }] };
  }
  if (typeof input.tenant_id !== "string" || input.tenant_id.trim() === "") {
    details.push({ field: "tenant_id", message: "tenant_id is required." });
  }
  const label = input.label === undefined ? null : (typeof input.label === "string" ? input.label.trim() : (details.push({ field: "label", message: "label must be a string." }), null));
  const algorithm = input.algorithm === undefined ? "scrypt" : (["scrypt", "sha256"].includes(input.algorithm) ? input.algorithm : (details.push({ field: "algorithm", message: "algorithm must be one of: scrypt, sha256." }), "scrypt"));
  if (details.length > 0) return { valid: false, details };
  return { valid: true, value: { tenant_id: input.tenant_id.trim(), label, algorithm } };
}

export function createUserService({
  store,
  trace = () => {},
  now = () => new Date(),
  idGenerator = () => `key_${randomUUID().replace(/-/g, "")}`,
  apiKeyGenerator = generateApiKey
} = {}) {
  if (!store) throw new TypeError("createUserService requires a store.");

  return {
    async provisionApiKey(input, { traceContext } = {}) {
      const result = normalizeProvisionUserInput(input);
      if (!result.valid) {
        const error = new UserValidationError("User input is invalid.", result.details);
        throw error;
      }
      const tenant = await store.getTenant(result.value.tenant_id);
      if (!tenant) throw new UserNotFoundError();

      const apiKey = apiKeyGenerator();
      const prefix = derivePrefix(apiKey);
      const { hash, algorithm } = hashApiKey(result.value.algorithm, apiKey);

      const keyId = idGenerator();
      const nowIso = now().toISOString();
      const row = {
        id: keyId,
        tenant_id: result.value.tenant_id,
        key_prefix: prefix,
        key_hash: hash,
        key_algorithm: algorithm,
        label: result.value.label,
        created_at: nowIso,
        last_used_at: null,
        revoked_at: null
      };
      const stored = await store.createApiKey(row);
      trace({
        event: "apikey.provision",
        tenant_id: row.tenant_id,
        key_id: stored.id,
        key_prefix: stored.key_prefix,
        key_algorithm: stored.key_algorithm,
        ctx: traceContext
      });
      return { apiKey, key: stored, tenant };
    },

    async resolveApiKey(apiKey, { traceContext } = {}) {
      if (typeof apiKey !== "string" || !apiKey.startsWith(API_KEY_PREFIX)) {
        return null;
      }
      const prefix = derivePrefix(apiKey);
      const candidates = await store.findApiKeysByPrefix(prefix);
      for (const row of candidates) {
        if (row.revoked_at) continue;
        if (!verifyApiKey(row.key_hash, row.key_algorithm, apiKey)) continue;
        trace({
          event: "apikey.resolve.hit",
          tenant_id: row.tenant_id,
          key_id: row.id,
          ctx: traceContext
        });
        // Update last_used_at; do not fail if it does not exist
        await store.updateApiKey(row.id, { last_used_at: now().toISOString() }).catch(() => undefined);
        return { tenant_id: row.tenant_id, key_id: row.id, algorithm: row.key_algorithm };
      }
      trace({ event: "apikey.resolve.miss", prefix, ctx: traceContext });
      return null;
    },

    async rotateApiKey(input, { traceContext } = {}) {
      const result = normalizeProvisionUserInput(input);
      if (!result.valid) {
        const error = new UserValidationError("User input is invalid.", result.details);
        throw error;
      }
      const tenant = await store.getTenant(result.value.tenant_id);
      if (!tenant) throw new UserNotFoundError();

      // Revoke all currently-active keys for this tenant. This is "rotate all" semantics.
      const active = await store.listApiKeys({ tenant_id: result.value.tenant_id, active_only: true });
      for (const row of active) {
        await store.updateApiKey(row.id, { revoked_at: now().toISOString() });
      }

      const apiKey = apiKeyGenerator();
      const prefix = derivePrefix(apiKey);
      const { hash, algorithm } = hashApiKey(result.value.algorithm, apiKey);
      const keyId = idGenerator();
      const nowIso = now().toISOString();
      const row = {
        id: keyId,
        tenant_id: result.value.tenant_id,
        key_prefix: prefix,
        key_hash: hash,
        key_algorithm: algorithm,
        label: result.value.label,
        created_at: nowIso,
        last_used_at: null,
        revoked_at: null
      };
      const stored = await store.createApiKey(row);
      trace({
        event: "apikey.rotate",
        tenant_id: row.tenant_id,
        revoked: active.length,
        new_key_id: stored.id,
        ctx: traceContext
      });
      return { apiKey, key: stored, tenant, revokedCount: active.length };
    },

    async revokeApiKey(keyId, { reason, traceContext } = {}) {
      if (typeof keyId !== "string" || keyId.trim() === "") {
        throw new UserValidationError("keyId is required.", [{ field: "keyId", message: "keyId is required." }]);
      }
      const row = await store.getApiKey(keyId);
      if (!row) throw new UserNotFoundError("API key was not found.");
      if (row.revoked_at) {
        return { key: row, already_revoked: true };
      }
      const updated = await store.updateApiKey(keyId, { revoked_at: now().toISOString() });
      trace({
        event: "apikey.revoke",
        tenant_id: row.tenant_id,
        key_id: keyId,
        reason: reason ?? null,
        ctx: traceContext
      });
      return { key: updated, already_revoked: false };
    },

    async listApiKeys(tenantId, { includeRevoked = false } = {}) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new UserValidationError("tenant_id is required.", [{ field: "tenant_id", message: "tenant_id is required." }]);
      }
      return store.listApiKeys({ tenant_id: tenantId, active_only: !includeRevoked });
    },

    async deleteKeysForTenant(tenantId, { traceContext } = {}) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new UserValidationError("tenant_id is required.", [{ field: "tenant_id", message: "tenant_id is required." }]);
      }
      const count = await store.deleteApiKeysForTenant(tenantId);
      trace({ event: "apikey.cascade_delete", tenant_id: tenantId, count, ctx: traceContext });
      return { deleted: count };
    }
  };
}
