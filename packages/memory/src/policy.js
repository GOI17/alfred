import { ALLOWED_MEMORY_TYPES } from "./domain.js";

const allowedTypeSet = new Set(ALLOWED_MEMORY_TYPES);
const MAX_QUERY_LENGTH = 240;

const SEARCH_SIGNALS = [
  { pattern: /\b(recall|remember|retrieve|look up|look for|what did we|how did we|previous|prior|last time|past)\b/i, reason: "recall or prior-context request" },
  { pattern: /\b(preferences?|prefers|preferred|likes|dislikes|always|never)\b/i, reason: "preference signal" },
  { pattern: /\b(architecture|architectural|product decision|decision|adr|rfc|chose|chosen|decided)\b/i, reason: "decision history signal" },
  { pattern: /\b(project history|history|milestone|release|roadmap)\b/i, reason: "project history signal" },
  { pattern: /\b(workflow|process|convention|standard|playbook|runbook|recurrent|recurring|again)\b/i, reason: "recurrent workflow signal" },
  { pattern: /\b(corrections?|corrected|fix my assumption|you were wrong|mistake|wrong before)\b/i, reason: "correction signal" }
];

const MECHANICAL_SIGNALS = [
  /\b(format|lint|rename|typo|import|sort|mechanical|self-contained)\b/i,
  /\b(run|execute)\b.*\btests?\b|\b(check status|show diff|git status)\b/i
];

const PERSIST_SIGNALS = [
  { type: "preference", pattern: /\b(preferences?|prefers|preferred|likes|dislikes|always|never)\b/i, reason: "stable preference" },
  { type: "decision", pattern: /\b(decision|decided|chose|chosen|approved|architecture|architectural|adr|rfc|product decision)\b/i, reason: "durable decision" },
  { type: "workflow", pattern: /\b(workflow|process|convention|standard|playbook|runbook|steps|procedure)\b/i, reason: "reusable workflow" },
  { type: "correction", pattern: /\b(correction|corrected|was wrong|mistake|instead use|do not use)\b/i, reason: "future correction" },
  { type: "project", pattern: /\b(project|repository|repo|package|module|service|architecture|uses|depends on|adapter)\b/i, reason: "stable project fact" },
  { type: "source", pattern: /\b(source|reference|documentation|docs|url|https?:\/\/)\b/i, reason: "useful source" },
  { type: "fact", pattern: /\b(is|are|uses|supports|requires|contains|owns|belongs to)\b/i, reason: "stable fact" }
];

const REJECTION_SIGNALS = [
  {
    pattern: /\b(password|passwd|api[_-]?key|secret|token|credential|private key|client secret|access key)\b\s*[:=]/i,
    reason: "candidate appears to contain secrets or credentials"
  },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[a-zA-Z0-9_-]{16,}\b/i, reason: "candidate appears to contain private keys or provider tokens" },
  { pattern: /\b\d{3}-\d{2}-\d{4}\b|\b\d{13,19}\b/, reason: "candidate appears to contain sensitive personal or payment data" },
  { pattern: /\b(diagnosis|medical record|passport|social security|ssn)\b/i, reason: "candidate appears to contain sensitive personal data" },
  { pattern: /\b(pid|port|tmp|temp|temporary|current run|current task|this run|stack trace|build log|test output|log output)\b/i, reason: "candidate is transient execution state or temporary log data" },
  { pattern: /\b(user|assistant|system)\s*:\s*.+\b(user|assistant|system)\s*:/is, reason: "candidate looks like a raw chat or transcript" },
  { pattern: /\b(chain[- ]of[- ]thought|internal reasoning|hidden reasoning|scratchpad|private reasoning)\b/i, reason: "candidate appears to contain internal reasoning" }
];

function normalizeText(...values) {
  return values
    .flatMap((value) => {
      if (value === undefined || value === null) return [];
      if (typeof value === "string") return [value];
      if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string");
      return [];
    })
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function textFromContext(context = {}) {
  return normalizeText(
    context.query,
    context.task,
    context.prompt,
    context.input,
    context.message,
    context.intent,
    context.content,
    context.description,
    context.signals,
    context.tags
  );
}

function textFromCandidate(candidate = {}) {
  return normalizeText(candidate.content, candidate.summary, candidate.title, candidate.type, candidate.tags, candidate.source);
}

function buildQuery(context, text) {
  const explicitQuery = typeof context.query === "string" ? context.query.trim() : "";
  const query = explicitQuery || text;
  if (!query) return undefined;
  return query.length > MAX_QUERY_LENGTH ? `${query.slice(0, MAX_QUERY_LENGTH - 1).trim()}…` : query;
}

function firstMatch(text, signals) {
  return signals.find((signal) => signal.pattern.test(text));
}

function hasExplicitBooleanSignal(context, names) {
  return names.some((name) => context[name] === true);
}

function isAllowedType(type) {
  return typeof type === "string" && allowedTypeSet.has(type);
}

function typeReason(type) {
  switch (type) {
    case "preference":
      return "candidate expresses a stable preference";
    case "decision":
      return "candidate records a durable decision";
    case "workflow":
      return "candidate records a reusable workflow";
    case "correction":
      return "candidate records a future correction";
    case "project":
      return "candidate records a stable project fact";
    case "source":
      return "candidate records a useful source";
    case "fact":
      return "candidate records a stable fact";
    default:
      return "candidate type is not recognized";
  }
}

export class MemoryPolicy {
  shouldSearch(context = {}) {
    const text = textFromContext(context);
    const explicitSignal = hasExplicitBooleanSignal(context, [
      "recall",
      "needsMemory",
      "priorPreference",
      "priorDecision",
      "projectHistory",
      "recurrentWorkflow",
      "correction"
    ]);
    const match = text ? firstMatch(text, SEARCH_SIGNALS) : undefined;

    if (match || explicitSignal) {
      return removeUndefined({
        allow: true,
        reason: match ? `Search allowed because context includes a ${match.reason}.` : "Search allowed because context explicitly asks for durable prior memory.",
        query: buildQuery(context, text)
      });
    }

    if (!text) {
      return { allow: false, reason: "Search denied because context has no durable memory signal." };
    }

    if (MECHANICAL_SIGNALS.some((pattern) => pattern.test(text))) {
      return { allow: false, reason: "Search denied because the task appears mechanical or self-contained." };
    }

    return { allow: false, reason: "Search denied because no prior-memory signal was detected." };
  }

  shouldPersist(candidate = {}, context = {}) {
    const candidateText = textFromCandidate(candidate);
    const contextText = textFromContext(context);
    const text = normalizeText(candidateText, contextText);

    if (!candidateText) {
      return { allow: false, reason: "Persistence denied because candidate content is empty or missing." };
    }

    const rejection = firstMatch(text, REJECTION_SIGNALS);
    if (rejection) {
      return { allow: false, reason: `Persistence denied because ${rejection.reason}.` };
    }

    const classified = this.classify(candidate, context);
    if (isAllowedType(candidate.type) && candidate.type !== "fact") {
      return { allow: true, reason: `Persistence allowed because ${typeReason(candidate.type)}.` };
    }

    const durableSignal = firstMatch(text, PERSIST_SIGNALS);
    if (durableSignal && durableSignal.type !== "fact") {
      return { allow: true, reason: `Persistence allowed because candidate contains a ${durableSignal.reason} signal.` };
    }

    if (classified.type === "fact" && /\b(stable|durable|canonical|source of truth|fact)\b/i.test(text)) {
      return { allow: true, reason: "Persistence allowed because candidate is marked as a stable fact." };
    }

    return { allow: false, reason: "Persistence denied because the candidate is not clearly durable and reusable." };
  }

  classify(candidate = {}, context = {}) {
    if (isAllowedType(candidate.type)) {
      return { type: candidate.type, reason: "Existing allowed memory type was provided." };
    }

    const text = normalizeText(textFromCandidate(candidate), textFromContext(context));
    for (const signal of PERSIST_SIGNALS) {
      if (signal.pattern.test(text)) {
        return { type: signal.type, reason: `Classified as ${signal.type} because candidate contains a ${signal.reason} signal.` };
      }
    }

    return { type: "fact", reason: "Classified as fact because no more specific memory type signal was detected." };
  }

  suggestNamespace(context = {}) {
    const explicitNamespace = context.namespace ?? context.explicitNamespace;
    if (typeof explicitNamespace === "string" && explicitNamespace.trim() !== "") {
      return { namespace: explicitNamespace, reason: "Using explicit namespace from context." };
    }

    const projectId =
      typeof context.projectId === "string"
        ? context.projectId
        : typeof context.project === "string"
          ? context.project
          : typeof context.project?.id === "string"
            ? context.project.id
            : undefined;

    if (projectId && projectId.trim() !== "") {
      return { namespace: `project:${projectId}`, reason: "Using project namespace derived from projectId." };
    }

    return { namespace: "personal", reason: "Using personal namespace because no namespace or projectId was provided." };
  }
}

export function createMemoryPolicy() {
  return new MemoryPolicy();
}

function removeUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
