// Bootstrap orchestrator. Composes the schema provisioner, the rate
// limiter, and the existing TenantService + UserService into a single
// `createTenantAndFirstKey({ ip, displayName, kind, sharedUrl })` call.
//
// Why a separate module:
//   * Keeps the console-router handler thin (HTTP concern only).
//   * Centralizes the policy: "web signup creates human_agent tenants
//     on a shared Postgres cluster with schema-per-tenant isolation".
//   * Makes the unit test trivial: pass mocks for each collaborator.

import { randomUUID } from "node:crypto";

export const BOOTSTRAP_KINDS = Object.freeze(["human_agent", "hybrid_with_human"]);

const DISPLAY_NAME_RE = /^[a-zA-Z0-9 _-]{1,64}$/;

export class BootstrapValidationError extends Error {
  constructor(details) {
    super("Bootstrap input is invalid.");
    this.name = "BootstrapValidationError";
    this.code = "validation_error";
    this.status = 400;
    this.details = details;
  }
}

export class BootstrapConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "BootstrapConfigError";
    this.code = "saas_not_configured";
    this.status = 503;
  }
}

export class BootstrapRateLimitedError extends Error {
  constructor(retryAfterMinutes) {
    super(`Too many signups. Try again in ${retryAfterMinutes} minute(s).`);
    this.name = "BootstrapRateLimitedError";
    this.code = "rate_limited";
    this.status = 429;
    this.retryAfterMinutes = retryAfterMinutes;
  }
}

function normalize({ displayName, kind }) {
  const details = [];
  if (typeof displayName !== "string" || !DISPLAY_NAME_RE.test(displayName)) {
    details.push({ field: "display_name", message: "display_name must be 1-64 chars of [a-zA-Z0-9 _-]." });
  }
  if (typeof kind !== "string" || !BOOTSTRAP_KINDS.includes(kind)) {
    details.push({ field: "kind", message: `kind must be one of: ${BOOTSTRAP_KINDS.join(", ")}.` });
  }
  if (details.length > 0) return { valid: false, details };
  return { valid: true, value: { displayName: displayName.trim(), kind } };
}

function generateTenantId() {
  return `usr_t_${randomUUID().replace(/-/g, "")}`;
}

export function createBootstrap({
  tenantService,
  userService,
  rateLimiter,
  schemaProvisioner,
  sharedUrl,                                // env: ALFRED_SAAS_DATABASE_URL
  now = () => new Date(),
  trace = () => {}
} = {}) {
  if (!tenantService) throw new TypeError("createBootstrap requires tenantService");
  if (!userService) throw new TypeError("createBootstrap requires userService");
  if (!rateLimiter) throw new TypeError("createBootstrap requires rateLimiter");
  if (!schemaProvisioner) throw new TypeError("createBootstrap requires schemaProvisioner");

  return {
    isConfigured() { return Boolean(sharedUrl) && sharedUrl.startsWith("postgres"); },

    async createTenantAndFirstKey({ ip, displayName, kind }) {
      if (!this.isConfigured()) {
        throw new BootstrapConfigError("ALFRED_SAAS_DATABASE_URL is not set. Bootstrap is disabled.");
      }

      // 1. Validate.
      const norm = normalize({ displayName, kind });
      if (!norm.valid) throw new BootstrapValidationError(norm.details);

      // 2. Rate limit.
      const limit = await rateLimiter.check({ ip });
      if (!limit.allowed) throw new BootstrapRateLimitedError(limit.retryAfterMinutes);

      // 3. Provision the schema + tenant + first key.
      const tenantId = generateTenantId();
      let provision;
      try {
        provision = await schemaProvisioner.provision({ tenantId, sharedUrl });
      } catch (err) {
        trace({ event: "tenant.bootstrap.failed", tenant_id: tenantId, stage: "schema", message: err.message });
        throw err;
      }

      let tenant;
      try {
        tenant = await tenantService.provisionTenant({
          id: tenantId,
          kind: norm.value.kind,
          storage_backend: "postgres",
          db_connection: provision.connectionString,
          display_name: norm.value.displayName,
          metadata: { source: "web_bootstrap", schema: provision.schema }
        });
      } catch (err) {
        trace({ event: "tenant.bootstrap.failed", tenant_id: tenantId, stage: "tenant", message: err.message });
        throw err;
      }

      let keyResult;
      try {
        keyResult = await userService.provisionApiKey({ tenant_id: tenant.id, label: "first-key" });
      } catch (err) {
        trace({ event: "tenant.bootstrap.failed", tenant_id: tenant.id, stage: "key", message: err.message });
        throw err;
      }

      // Record the successful attempt so the rate limiter sees it.
      try { await rateLimiter.record({ ip, displayName: norm.value.displayName, kind: norm.value.kind, result: "success", tenantId: tenant.id }); }
      catch { /* best-effort; don't fail the user if audit write fails */ }

      trace({
        event: "tenant.bootstrap",
        tenant_id: tenant.id,
        kind: tenant.kind,
        schema: provision.schema,
        key_id: keyResult.key.id
      });

      return {
        tenant: {
          id: tenant.id,
          display_name: tenant.display_name,
          kind: tenant.kind,
          storage_backend: tenant.storage_backend,
          db_connection: tenant.db_connection,
          created_at: tenant.created_at,
          metadata: tenant.metadata ?? {}
        },
        api_key: keyResult.apiKey,
        key_prefix: keyResult.key.key_prefix,
        key_id: keyResult.key.id
      };
    }
  };
}
