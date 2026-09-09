import { MemoryPolicy } from "./policy.js";
import { MemoryValidationError, normalizeCreateMemoryInput } from "./domain.js";

const policy = new MemoryPolicy();
const queues = new WeakMap();
const candidateFields = new Set(["content", "source", "type", "namespace", "projectId", "tags", "confidence"]);
const contextFields = new Set(["evidence", "origin", "persistenceDisabled"]);
const canonical = (value) => value.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();

function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function invalid() { throw new MemoryValidationError("Capture input is invalid. Use a concise candidate and minimal evidence context."); }

function validate(input) {
  if (!object(input) || Object.keys(input).some((key) => !["candidate", "context"].includes(key))) invalid();
  const { candidate, context } = input;
  if (!object(candidate) || !object(context)) invalid();
  if (Object.keys(candidate).some((key) => !candidateFields.has(key)) || Object.keys(context).some((key) => !contextFields.has(key))) invalid();
  if (typeof candidate.content !== "string" || !candidate.content.trim() || candidate.content.length > 1000) invalid();
  if (typeof candidate.source !== "string" || !candidate.source.trim() || candidate.source.length > 240) invalid();
  if (candidate.tags !== undefined && (!Array.isArray(candidate.tags) || candidate.tags.length > 10 || candidate.tags.some((tag) => typeof tag !== "string" || tag.length > 80))) invalid();
  if (typeof context.evidence !== "string" || !context.evidence.trim() || context.evidence.length > 2000) invalid();
  if (!["user", "verified"].includes(context.origin)) invalid();
  if (context.persistenceDisabled !== undefined && typeof context.persistenceDisabled !== "boolean") invalid();
  return { candidate, context };
}

async function emit(trace, outcome, reason, memory) {
  if (typeof trace !== "function") return;
  try {
    await trace({ event: "memory.capture", payload: {
      operation: "captureMemory", outcome, reason, provider_calls: 0,
      ...(memory ? { memory_id: memory.id } : {})
    } });
  } catch { /* Observability failure must not misreport a completed write. */ }
}

export async function captureMemory({ store, userId, input, now, idGenerator, trace }) {
  try {
    const { candidate, context } = validate(input);
    const memory = normalizeCreateMemoryInput({ ...candidate, type: candidate.type ?? policy.classify(candidate).type }, { userId, now: now(), id: idGenerator() });
    const decision = policy.shouldPersist(candidate, context);
    if (!decision.allow) {
      await emit(trace, "skipped", "policy_denied");
      return { status: "skipped", reason: decision.reason };
    }
    await emit(trace, "allowed", "durable_grounded_candidate");
    // Serialize captures sharing a store. Completed retries are also deduplicated
    // after process restart; this is not a distributed transaction guarantee.
    const previous = queues.get(store) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(async () => {
      const content = canonical(memory.content);
      for (let offset = 0; ; offset += 100) {
        const page = await store.list(memory.userId, { namespace: memory.namespace, limit: 100, offset });
        const duplicate = page.items.find((item) => item.userId === memory.userId && item.namespace === memory.namespace && canonical(item.content) === content);
        if (duplicate) {
          await emit(trace, "duplicate", "exact_duplicate", duplicate);
          return { status: "duplicate", memory: duplicate, reason: "Equivalent content already exists in this namespace." };
        }
        if (offset + page.items.length >= page.pagination.total || page.items.length === 0) break;
      }
      const stored = await store.create(memory);
      if (!stored || typeof stored.id !== "string") throw new Error("Memory store did not confirm the write.");
      await emit(trace, "created", "persisted", stored);
      return { status: "created", memory: stored, reason: decision.reason };
    });
    queues.set(store, pending);
    try { return await pending; }
    finally { if (queues.get(store) === pending) queues.delete(store); }
  } catch (error) {
    await emit(trace, "failed", error instanceof MemoryValidationError ? "invalid_input" : "storage_error");
    throw error;
  }
}
