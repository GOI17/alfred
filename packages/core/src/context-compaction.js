import fs from "node:fs";
import path from "node:path";

const DEFAULT_MODEL_CONTEXT = 128000;
const CHARS_PER_TOKEN_APPROX = 4;

export function defaultTokenEstimator(messages) {
  return messages.reduce((total, message) => {
    const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
    return total + Math.ceil(content.length / CHARS_PER_TOKEN_APPROX) + 4;
  }, 0);
}

export function detectContextUsage({ messages, tokenEstimator = defaultTokenEstimator }) {
  const currentTokens = tokenEstimator(messages);
  const modelContext = DEFAULT_MODEL_CONTEXT;
  return {
    current_tokens: currentTokens,
    model_context: modelContext,
    ratio: currentTokens / modelContext
  };
}

export function resolveThreshold({
  model_context,
  globalDefault = 0.35,
  profileOverride,
  projectIdentity
}) {
  const sources = ["global_default"];
  let ratio = globalDefault;

  if (typeof profileOverride === "number" && profileOverride > 0 && profileOverride <= 1) {
    ratio = profileOverride;
    sources.push("profile_override");
  }

  if (projectIdentity?.origin_url) {
    const projectThreshold = projectIdentity.compaction_threshold;
    if (typeof projectThreshold === "number" && projectThreshold > 0 && projectThreshold <= 1) {
      ratio = projectThreshold;
      sources.push("project_override");
    }
  }

  return {
    threshold_ratio: ratio,
    threshold_tokens: Math.floor(model_context * ratio),
    sources
  };
}

export function summarizeWithHeuristics(messages, targetTokens) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  const keepSystem = messages.filter((message) => message.role === "system" || message.role === "developer");
  const turns = messages.filter((message) => message.role !== "system" && message.role !== "developer");

  const seenToolResults = new Set();
  const dedupedTurns = [];
  for (const message of turns) {
    const key = typeof message.content === "string" ? message.content : JSON.stringify(message.content);
    if (message.role === "tool" || message.role === "function") {
      if (seenToolResults.has(key)) continue;
      seenToolResults.add(key);
    }
    dedupedTurns.push(message);
  }

  const shortTurns = dedupedTurns.slice(0, 2);
  const recentTurns = dedupedTurns.slice(-8);
  const selectedTurns = [...shortTurns];
  for (const turn of recentTurns) {
    if (!selectedTurns.includes(turn)) {
      selectedTurns.push(turn);
    }
  }

  const candidateSummary = [...keepSystem, ...selectedTurns];
  const estimated = defaultTokenEstimator(candidateSummary);

  if (estimated <= targetTokens) {
    return candidateSummary;
  }

  const trimmed = candidateSummary.map((message) => {
    const original = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
    const maxChars = Math.max(40, Math.floor(targetTokens * CHARS_PER_TOKEN_APPROX / (candidateSummary.length + 1)));
    const trimmedContent = original.length > maxChars ? `${original.slice(0, maxChars)}…` : original;
    return { ...message, content: trimmedContent };
  });

  return trimmed;
}

function writeLocalTrace(traceDir, traceEvent) {
  fs.mkdirSync(traceDir, { recursive: true });
  const filePath = path.join(traceDir, `${traceEvent.event}-${traceEvent.data.trace_id}.json`);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(traceEvent, null, 2)}\n`);
  fs.renameSync(temporaryPath, filePath);
  return filePath;
}

function createCompactionTrace({ event, data }) {
  const timestamp = new Date().toISOString();
  const traceId = `context-compaction-${timestamp}-${process.hrtime.bigint()}`;
  return {
    trace_id: traceId,
    timestamp,
    event,
    actor: "core/context-compaction",
    data: {
      ...data,
      trace_id: traceId,
      timestamp
    }
  };
}

export async function compactContext({
  messages,
  targetTokens,
  projectIdentity,
  mode = "local-only",
  store = null,
  providerGateway = null,
  approval = false
}) {
  const traceEvents = [];
  const traceDir = path.join(process.cwd(), ".alfred", "observability");

  traceEvents.push(
    createCompactionTrace({
      event: "context_compaction_triggered",
      data: {
        target_tokens: targetTokens,
        mode,
        project_root: projectIdentity?.project_root ?? null,
        origin_url: projectIdentity?.origin_url ?? null
      }
    })
  );

  let summaryMessages = summarizeWithHeuristics(messages, targetTokens);
  let providerCalls = 0;

  const heuristicTokens = defaultTokenEstimator(summaryMessages);
  const heuristicSufficient = heuristicTokens <= targetTokens;

  if (heuristicSufficient) {
    traceEvents.push(
      createCompactionTrace({
        event: "provider_request_avoided",
        data: {
          reason: "local_heuristics_sufficient",
          target_tokens: targetTokens,
          heuristic_tokens: heuristicTokens,
          provider_calls: 0
        }
      })
    );
  } else if (approval === true && providerGateway && typeof providerGateway.summarize === "function") {
    const providerResult = await providerGateway.summarize(messages, targetTokens);
    summaryMessages = Array.isArray(providerResult) ? providerResult : summaryMessages;
    providerCalls = 1;
    traceEvents.push(
      createCompactionTrace({
        event: "provider_request_reduced",
        data: {
          reason: "local_heuristics_insufficient_provider_fallback",
          target_tokens: targetTokens,
          heuristic_tokens: heuristicTokens,
          provider_calls: providerCalls,
          approval: true
        }
      })
    );
  } else {
    traceEvents.push(
      createCompactionTrace({
        event: "provider_request_avoided",
        data: {
          reason: "local_heuristics_insufficient_no_approval",
          target_tokens: targetTokens,
          heuristic_tokens: heuristicTokens,
          provider_calls: 0,
          approval: false
        }
      })
    );
  }

  if (mode === "multi-tenant" && store && typeof store.saveCompactionSummary === "function") {
    await store.saveCompactionSummary({
      project_identity: projectIdentity,
      compaction_generation: traceEvents.length,
      summary_messages: summaryMessages,
      generated_at: new Date().toISOString()
    });
  } else {
    for (const traceEvent of traceEvents) {
      writeLocalTrace(traceDir, traceEvent);
    }
  }

  return {
    summary_messages: summaryMessages,
    provider_calls: providerCalls,
    trace_events: traceEvents.map((event) => event.event)
  };
}
