// Sessions domain: durable work sessions tied to a tenant. A session captures
// a discrete work context (e.g. "client A onboarding q3", "personal finance
// planner 2026") and contains Topics.
//
// Why sessions? Because namespace + type alone cannot represent nested
// structures. Sessions are the conceptual container for ongoing work.

import { randomUUID } from "node:crypto";

export const SESSION_STATUSES = Object.freeze([
  "active",
  "paused",
  "closed",
  "archived"
]);

const allowedSessionStatus = new Set(SESSION_STATUSES);

export class SessionValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "SessionValidationError";
    this.code = "validation_error";
    this.status = 400;
    this.details = details;
  }
}

export class SessionNotFoundError extends Error {
  constructor(message = "Session was not found.") {
    super(message);
    this.name = "SessionNotFoundError";
    this.code = "not_found";
    this.status = 404;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, field, details) {
  if (typeof value !== "string" || value.trim() === "") {
    details.push({ field, message: `${field} is required.` });
    return undefined;
  }
  return value.trim();
}

function optionalString(value, field, details) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    details.push({ field, message: `${field} must be a string.` });
    return undefined;
  }
  return value.trim();
}

export function normalizeCreateSessionInput(input) {
  const details = [];
  const body = isPlainObject(input) ? input : {};
  const tenant_id = requireString(body.tenant_id, "tenant_id", details);
  const title = requireString(body.title, "title", details);
  const description = body.description === undefined ? null : optionalString(body.description, "description", details);
  const status = body.status === undefined ? "active" : (allowedSessionStatus.has(body.status) ? body.status : (details.push({ field: "status", message: `status must be one of: ${SESSION_STATUSES.join(", ")}.` }), null));
  if (details.length > 0) return { valid: false, details };
  return {
    valid: true,
    value: {
      id: body.id || `usr_s_${randomUUID().replace(/-/g, "")}`,
      tenant_id,
      title,
      description,
      status
    }
  };
}

export function normalizeUpdateSessionInput(input) {
  const details = [];
  const body = isPlainObject(input) ? input : {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, "title")) {
    patch.title = requireString(body.title, "title", details);
  }
  if (Object.prototype.hasOwnProperty.call(body, "description")) {
    patch.description = body.description === null ? null : optionalString(body.description, "description", details);
  }
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    if (!allowedSessionStatus.has(body.status)) {
      details.push({ field: "status", message: `status must be one of: ${SESSION_STATUSES.join(", ")}.` });
    } else {
      patch.status = body.status;
    }
  }
  if (Object.keys(patch).length === 0) {
    details.push({ field: "body", message: "At least one field is required." });
  }
  if (details.length > 0) return { valid: false, details };
  return { valid: true, value: patch };
}

export function createSessionService({ store, now = () => new Date().toISOString() } = {}) {
  if (!store) throw new TypeError("createSessionService requires a store.");
  return {
    async createSession(input) {
      const result = normalizeCreateSessionInput(input);
      if (!result.valid) throw new SessionValidationError("Session input is invalid.", result.details);
      const created_at = now();
      return store.create({
        ...result.value,
        created_at,
        updated_at: created_at
      });
    },
    async getSession(id) {
      const row = await store.get(id);
      if (!row) throw new SessionNotFoundError();
      return row;
    },
    async listSessionsByTenant(tenant_id, { status, limit = 50, offset = 0 } = {}) {
      return store.listByTenant(tenant_id, { status, limit, offset });
    },
    async updateSession(id, input) {
      const result = normalizeUpdateSessionInput(input);
      if (!result.valid) throw new SessionValidationError("Session input is invalid.", result.details);
      const row = await store.get(id);
      if (!row) throw new SessionNotFoundError();
      return store.update(id, { ...result.value, updated_at: now() });
    },
    async transitionSession(id, status) {
      if (!allowedSessionStatus.has(status)) {
        throw new SessionValidationError("Status is invalid.", [
          { field: "status", message: `status must be one of: ${SESSION_STATUSES.join(", ")}.` }
        ]);
      }
      const row = await store.get(id);
      if (!row) throw new SessionNotFoundError();
      return store.update(id, { status, updated_at: now() });
    },
    async deleteSession(id) {
      const row = await store.get(id);
      if (!row) throw new SessionNotFoundError();
      await store.delete(id);
      return { deleted: true };
    }
  };
}

export { randomUUID };
