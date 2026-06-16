import { randomUUID } from "node:crypto";

export const ALLOWED_MEMORY_TYPES = Object.freeze([
  "preference",
  "fact",
  "decision",
  "workflow",
  "project",
  "correction",
  "source"
]);

const allowedTypeSet = new Set(ALLOWED_MEMORY_TYPES);

export class MemoryValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "MemoryValidationError";
    this.code = "validation_error";
    this.status = 400;
    this.details = details;
  }
}

export class MemoryNotFoundError extends Error {
  constructor(message = "Memory was not found.") {
    super(message);
    this.name = "MemoryNotFoundError";
    this.code = "not_found";
    this.status = 404;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, field, details) {
  if (typeof value !== "string" || value.trim() === "") {
    details.push({ field, message: `${field} must be a non-empty string.` });
    return undefined;
  }
  return value.trim();
}

function optionalString(value, field, details) {
  if (value === undefined || value === null) return undefined;
  return requireString(value, field, details);
}

function normalizeTags(value, details) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    details.push({ field: "tags", message: "tags must be an array of strings." });
    return [];
  }

  const normalized = [];
  for (const tag of value) {
    if (typeof tag !== "string" || tag.trim() === "") {
      details.push({ field: "tags", message: "tags must contain only non-empty strings." });
      continue;
    }
    const cleanTag = tag.trim();
    if (!normalized.includes(cleanTag)) normalized.push(cleanTag);
  }
  return normalized;
}

function normalizeMetadata(value, details, allowUndefined = true) {
  if (value === undefined) return allowUndefined ? undefined : {};
  if (value === null) return null;
  if (!isPlainObject(value)) {
    details.push({ field: "metadata", message: "metadata must be an object when provided." });
    return undefined;
  }
  return value;
}

function normalizeConfidence(value, details) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || Number.isNaN(value) || value < 0 || value > 1) {
    details.push({ field: "confidence", message: "confidence must be a number between 0 and 1." });
    return undefined;
  }
  return value;
}

function normalizeInstant(value, field, details) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    details.push({ field, message: `${field} must be an ISO-8601 string.` });
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    details.push({ field, message: `${field} must be a valid ISO-8601 string.` });
    return undefined;
  }
  return date.toISOString();
}

function normalizeType(value, details) {
  const type = requireString(value, "type", details);
  if (type && !allowedTypeSet.has(type)) {
    details.push({ field: "type", message: `type must be one of: ${ALLOWED_MEMORY_TYPES.join(", ")}.` });
  }
  return type;
}

function throwIfInvalid(details) {
  if (details.length > 0) {
    throw new MemoryValidationError("Memory input is invalid.", details);
  }
}

function normalizeUserId(value) {
  const details = [];
  const userId = requireString(value, "userId", details);
  throwIfInvalid(details);
  return userId;
}

export function normalizeCreateMemoryInput(input, { userId, now = new Date(), id = randomUUID() } = {}) {
  const details = [];
  const body = isPlainObject(input) ? input : {};
  if (!isPlainObject(input)) details.push({ field: "body", message: "Request body must be a JSON object." });

  const normalizedUserId = requireString(userId, "userId", details);
  const type = normalizeType(body.type, details);
  const content = requireString(body.content, "content", details);
  const source = requireString(body.source, "source", details);
  const tags = normalizeTags(body.tags, details);
  const projectId = optionalString(body.projectId, "projectId", details);
  const metadata = normalizeMetadata(body.metadata, details, false) ?? {};
  const confidence = normalizeConfidence(body.confidence, details);
  const expiresAt = normalizeInstant(body.expiresAt, "expiresAt", details);
  const nowIso = normalizeInstant(now.toISOString(), "now", details);

  throwIfInvalid(details);

  return removeUndefined({
    id,
    userId: normalizedUserId,
    projectId,
    type,
    content,
    tags,
    source,
    metadata,
    confidence,
    expiresAt,
    createdAt: nowIso,
    updatedAt: nowIso
  });
}

export function normalizeUpdateMemoryInput(input, { now = new Date() } = {}) {
  const details = [];
  const body = isPlainObject(input) ? input : {};
  if (!isPlainObject(input)) details.push({ field: "body", message: "Request body must be a JSON object." });

  const patch = {};
  if (Object.prototype.hasOwnProperty.call(body, "type")) patch.type = normalizeType(body.type, details);
  if (Object.prototype.hasOwnProperty.call(body, "content")) patch.content = requireString(body.content, "content", details);
  if (Object.prototype.hasOwnProperty.call(body, "source")) patch.source = requireString(body.source, "source", details);
  if (Object.prototype.hasOwnProperty.call(body, "tags")) patch.tags = normalizeTags(body.tags, details);
  if (Object.prototype.hasOwnProperty.call(body, "projectId")) patch.projectId = optionalString(body.projectId, "projectId", details) ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "metadata")) patch.metadata = normalizeMetadata(body.metadata, details);
  if (Object.prototype.hasOwnProperty.call(body, "confidence")) patch.confidence = normalizeConfidence(body.confidence, details) ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "expiresAt")) patch.expiresAt = normalizeInstant(body.expiresAt, "expiresAt", details) ?? null;

  if (Object.keys(patch).length === 0) {
    details.push({ field: "body", message: "At least one editable memory field is required." });
  }

  patch.updatedAt = now.toISOString();
  throwIfInvalid(details);
  return patch;
}

export function normalizeListOptions(options = {}) {
  const details = [];
  const limit = normalizePositiveInteger(options.limit, "limit", 50, details, { min: 1, max: 100 });
  const offset = normalizePositiveInteger(options.offset, "offset", 0, details, { min: 0, max: 100000 });
  const type = options.type === undefined ? undefined : normalizeType(options.type, details);
  const projectId = optionalString(options.projectId, "projectId", details);
  const tag = optionalString(options.tag, "tag", details);
  throwIfInvalid(details);
  return removeUndefined({ limit, offset, type, projectId, tag });
}

export function normalizeSearchOptions(options = {}) {
  const listOptions = normalizeListOptions(options);
  const details = [];
  const q = requireString(options.q, "q", details);
  throwIfInvalid(details);
  return { ...listOptions, q };
}

export function normalizeMemoryId(value) {
  const details = [];
  const id = requireString(value, "id", details);
  throwIfInvalid(details);
  return id;
}

function normalizePositiveInteger(value, field, fallback, details, { min, max }) {
  if (value === undefined || value === null || value === "") return fallback;
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^[0-9]+$/.test(value)
        ? Number(value)
        : Number.NaN;
  if (!Number.isInteger(number) || number < min || number > max) {
    details.push({ field, message: `${field} must be an integer between ${min} and ${max}.` });
    return fallback;
  }
  return number;
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

export function createMemoryService({ store, now = () => new Date(), idGenerator = randomUUID } = {}) {
  if (!store) throw new TypeError("createMemoryService requires a store.");

  return {
    async createMemory(userId, input) {
      const memory = normalizeCreateMemoryInput(input, { userId, now: now(), id: idGenerator() });
      return store.create(memory);
    },

    async listMemories(userId, options = {}) {
      return store.list(normalizeUserId(userId), normalizeListOptions(options));
    },

    async searchMemories(userId, options = {}) {
      return store.search(normalizeUserId(userId), normalizeSearchOptions(options));
    },

    async getMemory(userId, id) {
      const memory = await store.get(normalizeUserId(userId), normalizeMemoryId(id));
      if (!memory) throw new MemoryNotFoundError();
      return memory;
    },

    async updateMemory(userId, id, input) {
      const memory = await store.update(normalizeUserId(userId), normalizeMemoryId(id), normalizeUpdateMemoryInput(input, { now: now() }));
      if (!memory) throw new MemoryNotFoundError();
      return memory;
    },

    async deleteMemory(userId, id) {
      const deleted = await store.delete(normalizeUserId(userId), normalizeMemoryId(id));
      if (!deleted) throw new MemoryNotFoundError();
      return { deleted: true };
    }
  };
}
