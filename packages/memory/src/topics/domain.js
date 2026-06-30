import { randomUUID } from "node:crypto";

export const TOPIC_STATUSES = Object.freeze([
  "created", "pending", "in_progress", "blocked", "completed", "cancelled"
]);
const allowed = new Set(TOPIC_STATUSES);
const VALID_TRANSITIONS = {
  created: ["pending", "in_progress", "blocked", "cancelled"],
  pending: ["in_progress", "blocked", "cancelled"],
  in_progress: ["blocked", "completed", "cancelled"],
  blocked: ["pending", "in_progress", "completed", "cancelled"],
  completed: [],
  cancelled: []
};

export class TopicValidationError extends Error {
  constructor(message, details = []) { super(message); this.name = "TopicValidationError"; this.code = "validation_error"; this.status = 400; this.details = details; }
}
export class TopicNotFoundError extends Error {
  constructor(message = "Topic was not found.") { super(message); this.name = "TopicNotFoundError"; this.code = "not_found"; this.status = 404; }
}
export class TopicStateError extends Error {
  constructor(message) { super(message); this.name = "TopicStateError"; this.code = "topic_state_error"; this.status = 409; }
}

function isPlainObject(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function requireString(v, f, d) { if (typeof v !== "string" || v.trim() === "") { d.push({ field: f, message: `${f} is required.` }); return undefined; } return v.trim(); }
function optionalString(v, f, d) { if (v === undefined || v === null) return undefined; if (typeof v !== "string" || v.trim() === "") { d.push({ field: f, message: `${f} must be a string.` }); return undefined; } return v.trim(); }

export function normalizeCreateTopicInput(input) {
  const details = [];
  const body = isPlainObject(input) ? input : {};
  const tenant_id = requireString(body.tenant_id, "tenant_id", details);
  const session_id = requireString(body.session_id, "session_id", details);
  const title = requireString(body.title, "title", details);
  const description = body.description === undefined ? null : optionalString(body.description, "description", details);
  const status = body.status === undefined ? "created" : (allowed.has(body.status) ? body.status : (details.push({ field: "status", message: `status must be one of: ${TOPIC_STATUSES.join(", ")}.` }), null));
  if (details.length > 0) return { valid: false, details };
  return { valid: true, value: { id: body.id || `usr_t_${randomUUID().replace(/-/g, "")}`, tenant_id, session_id, title, description, status } };
}

export function canTransition(from, to) {
  if (!allowed.has(from) || !allowed.has(to)) return false;
  if (from === to) return true;
  return (VALID_TRANSITIONS[from] || []).includes(to);
}

export function createTopicService({ store, now = () => new Date().toISOString() } = {}) {
  if (!store) throw new TypeError("createTopicService requires a store.");
  return {
    async createTopic(input) {
      const result = normalizeCreateTopicInput(input);
      if (!result.valid) throw new TopicValidationError("Topic input is invalid.", result.details);
      const ts = now();
      return store.create({ ...result.value, created_at: ts, updated_at: ts });
    },
    async getTopic(id) {
      const row = await store.get(id);
      if (!row) throw new TopicNotFoundError();
      return row;
    },
    async listTopicsBySession(sessionId, { status, limit = 50, offset = 0 } = {}) {
      return store.listBySession(sessionId, { status, limit, offset });
    },
    async transitionTopic(id, targetStatus) {
      const row = await store.get(id);
      if (!row) throw new TopicNotFoundError();
      if (!canTransition(row.status, targetStatus)) {
        throw new TopicStateError(
          `Cannot transition topic from ${row.status} to ${targetStatus}.`
        );
      }
      return store.update(id, { status: targetStatus, updated_at: now() });
    },
    async deleteTopic(id) {
      const row = await store.get(id);
      if (!row) throw new TopicNotFoundError();
      await store.delete(id);
      return { deleted: true };
    }
  };
}

export { randomUUID };
