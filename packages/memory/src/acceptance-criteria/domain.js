import { randomUUID } from "node:crypto";

export const AC_STATUSES = Object.freeze([
  "created", "pending", "in_progress", "blocked", "completed", "cancelled"
]);
const allowed = new Set(AC_STATUSES);

export class ACValidationError extends Error {
  constructor(message, details = []) { super(message); this.name = "ACValidationError"; this.code = "validation_error"; this.status = 400; this.details = details; }
}
export class ACNotFoundError extends Error {
  constructor(message = "Acceptance criterion was not found.") { super(message); this.name = "ACNotFoundError"; this.code = "not_found"; this.status = 404; }
}

function isPlainObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function requireString(v, f, d) { if (typeof v !== "string" || v.trim() === "") { d.push({ field: f, message: `${f} is required.` }); return undefined; } return v.trim(); }

export function normalizeCreateACInput(input) {
  const details = [];
  const body = isPlainObject(input) ? input : {};
  const tenant_id = requireString(body.tenant_id, "tenant_id", details);
  const topic_id = requireString(body.topic_id, "topic_id", details);
  const description = requireString(body.description, "description", details);
  const status = body.status === undefined ? "created" : (allowed.has(body.status) ? body.status : (details.push({ field: "status", message: `status must be one of: ${AC_STATUSES.join(", ")}.` }), null));
  if (details.length > 0) return { valid: false, details };
  return {
    valid: true,
    value: {
      id: body.id || `usr_ac_${randomUUID().replace(/-/g, "")}`,
      tenant_id,
      topic_id,
      description,
      status
    }
  };
}

export function deriveTopicRollup(criteria) {
  // criteria: Array<{ status }>
  const counts = { created: 0, pending: 0, in_progress: 0, blocked: 0, completed: 0, cancelled: 0 };
  for (const c of criteria) counts[c.status] = (counts[c.status] || 0) + 1;
  return {
    total: criteria.length,
    counts,
    progressPct: criteria.length
      ? Math.round((counts.completed / criteria.length) * 100)
      : 0
  };
}

export function createAcceptanceCriteriaService({ store, now = () => new Date().toISOString() } = {}) {
  if (!store) throw new TypeError("createAcceptanceCriteriaService requires a store.");
  return {
    async createAC(input) {
      const result = normalizeCreateACInput(input);
      if (!result.valid) throw new ACValidationError("Acceptance criterion input is invalid.", result.details);
      const ts = now();
      return store.create({ ...result.value, created_at: ts, updated_at: ts });
    },
    async getAC(id) {
      const row = await store.get(id);
      if (!row) throw new ACNotFoundError();
      return row;
    },
    async listACsByTopic(topicId, { status, limit = 50, offset = 0 } = {}) {
      return store.listByTopic(topicId, { status, limit, offset });
    },
    async transitionAC(id, targetStatus) {
      const row = await store.get(id);
      if (!row) throw new ACNotFoundError();
      if (!allowed.has(targetStatus)) {
        throw new ACValidationError("Target status invalid.", [
          { field: "status", message: `status must be one of: ${AC_STATUSES.join(", ")}.` }
        ]);
      }
      return store.update(id, { status: targetStatus, updated_at: now() });
    },
    async deleteAC(id) {
      const row = await store.get(id);
      if (!row) throw new ACNotFoundError();
      await store.delete(id);
      return { deleted: true };
    },
    rollup(criteria) { return deriveTopicRollup(criteria); }
  };
}

export { randomUUID };
