import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function isTemporaryAgentId(agentId) {
  return agentId === "temporary" || agentId.startsWith("temporary");
}

function readGlobalModels(globalConfigPath) {
  if (!globalConfigPath || !fs.existsSync(globalConfigPath)) return {};
  try {
    const text = fs.readFileSync(globalConfigPath, "utf8");
    return text.trim() ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

export function isValidModelId(value) {
  return typeof value === "string" && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}

function collectModelEntryErrors(entry, pointer) {
  const errors = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`${pointer} must be an object`);
    return errors;
  }
  if (Object.hasOwn(entry, "primary") && entry.primary !== null && !isValidModelId(entry.primary)) {
    errors.push(`${pointer}.primary must be a non-empty model id string`);
  }
  if (Object.hasOwn(entry, "fallbacks")) {
    if (!Array.isArray(entry.fallbacks)) {
      errors.push(`${pointer}.fallbacks must be an array`);
    } else {
      entry.fallbacks.forEach((model, index) => {
        if (!isValidModelId(model)) errors.push(`${pointer}.fallbacks[${index}] must be a non-empty model id string`);
      });
    }
  }
  return errors;
}

export function validateModelBinding(binding, { pointer = "binding" } = {}) {
  const errors = [];
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    errors.push(`${pointer} must be an object`);
  } else {
    for (const [agentId, entry] of Object.entries(binding)) {
      errors.push(...collectModelEntryErrors(entry, `${pointer}.${agentId}`));
    }
  }
  return {
    status: errors.length === 0 ? "pass" : "fail",
    errors,
    provider_calls: 0
  };
}

export function validateModelsConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    errors.push("models config must be an object");
  } else {
    for (const [key, value] of Object.entries(config)) {
      if (key === "fallbacks") {
        if (!Array.isArray(value)) {
          errors.push("fallbacks must be an array");
        } else {
          value.forEach((model, index) => {
            if (!isValidModelId(model)) errors.push(`fallbacks[${index}] must be a non-empty model id string`);
          });
        }
        continue;
      }
      errors.push(...collectModelEntryErrors(value, key));
    }
  }
  return {
    status: errors.length === 0 ? "pass" : "fail",
    errors,
    provider_calls: 0
  };
}

function pickTemporaryConfig(globalModels, agentId, creatorAgentId) {
  if (!isTemporaryAgentId(agentId)) return null;
  if (creatorAgentId && globalModels[`temporary:${creatorAgentId}`]) {
    return { key: `temporary:${creatorAgentId}`, config: globalModels[`temporary:${creatorAgentId}`] };
  }
  if (globalModels["temporary:*"]) {
    return { key: "temporary:*", config: globalModels["temporary:*"] };
  }
  if (globalModels.temporary) {
    return { key: "temporary", config: globalModels.temporary };
  }
  return null;
}

function pickAgentConfig(globalModels, agentId) {
  if (globalModels[agentId]) {
    return { key: agentId, config: globalModels[agentId] };
  }
  return null;
}

export function resolveFallbacks(agentConfig, globalFallbacks) {
  const agentFallbacks = Array.isArray(agentConfig?.fallbacks) ? [...agentConfig.fallbacks] : [];
  const systemFallbacks = Array.isArray(globalFallbacks) ? globalFallbacks : [];
  const seen = new Set(agentFallbacks);
  return [...agentFallbacks, ...systemFallbacks.filter((model) => !seen.has(model))];
}

export function resolveTemporaryModel({ agentId, creatorAgentId, globalModels }) {
  const picked = pickTemporaryConfig(globalModels, agentId, creatorAgentId);
  if (!picked) return null;
  return {
    agent_id: agentId,
    primary: picked.config.primary ?? null,
    fallbacks: Array.isArray(picked.config.fallbacks) ? [...picked.config.fallbacks] : [],
    source: picked.key
  };
}

function mergeFallbackArrays(front, back) {
  const seen = new Set(front);
  return [...front, ...back.filter((model) => !seen.has(model))];
}

function applyLayer(result, layer, source) {
  if (!layer) return result;
  const contributes = layer.primary || Array.isArray(layer.fallbacks);
  if (!contributes) return result;

  const next = { ...result };
  if (layer.primary && next.primary === null) {
    next.primary = layer.primary;
  }
  if (Array.isArray(layer.fallbacks)) {
    next.fallbacks = mergeFallbackArrays(next.fallbacks, layer.fallbacks);
  }
  if (source) {
    const existingIndex = next.sources.indexOf(source);
    if (existingIndex !== -1) next.sources.splice(existingIndex, 1);
    next.sources.push(source);
  }
  return next;
}

function buildBaseLayers({
  agentId,
  harnessModelBinding,
  profileManager,
  globalModels,
  explicitAgentConfig
}) {
  const systemFallbacks = Array.isArray(globalModels.fallbacks) ? globalModels.fallbacks : [];
  const wildcard = globalModels["*"];
  let result = { primary: null, fallbacks: [], sources: [] };

  // Layer 1: harness override (highest precedence)
  if (harnessModelBinding && typeof harnessModelBinding === "object") {
    const binding = harnessModelBinding[agentId] ?? harnessModelBinding["*"];
    if (binding) {
      result = applyLayer(result, binding, "harness");
    }
  }

  // Layer 2: profile overlay
  const profileOverlay = profileManager?.resolveModels?.(agentId) ?? null;
  if (profileOverlay) {
    result = applyLayer(result, profileOverlay, "profile");
  }

  // Layer 3: global agent-specific or temporary override
  const agentOverride = explicitAgentConfig
    ? { key: agentId, config: explicitAgentConfig }
    : pickAgentConfig(globalModels, agentId);
  if (agentOverride) {
    result = applyLayer(result, agentOverride.config, "global");
  }

  // Layer 4: global wildcard fills any remaining gaps
  if (wildcard) {
    result = applyLayer(result, wildcard, "global");
  }

  // Layer 5: system-wide fallback chain appended after all other sources
  if (systemFallbacks.length > 0) {
    result = applyLayer(result, { fallbacks: systemFallbacks }, "system_fallback");
  }

  return result;
}

function resolveModelAssignmentInternal({
  agentId,
  creatorAgentId,
  harness,
  harnessModelBinding,
  profileManager,
  globalConfigPath
}) {
  const globalModels = readGlobalModels(globalConfigPath);
  const temporaryOverride = pickTemporaryConfig(globalModels, agentId, creatorAgentId);

  let result;
  let inherited = false;
  if (temporaryOverride) {
    result = buildBaseLayers({
      agentId,
      harnessModelBinding,
      profileManager,
      globalModels,
      explicitAgentConfig: temporaryOverride.config
    });
  } else if (isTemporaryAgentId(agentId) && creatorAgentId) {
    result = resolveModelAssignmentInternal({
      agentId: creatorAgentId,
      harness,
      harnessModelBinding,
      profileManager,
      globalConfigPath
    });
    inherited = true;
  } else {
    result = buildBaseLayers({ agentId, harnessModelBinding, profileManager, globalModels });
  }

  let primary = result.primary;
  let fallbacks = result.fallbacks;
  const sources = inherited ? [...result.sources, "temporary_inheritance"] : [...result.sources];

  // Final fallback when no primary was configured anywhere.
  if (!primary) {
    const wildcard = globalModels["*"];
    if (wildcard?.primary) {
      primary = wildcard.primary;
      if (!sources.includes("global")) sources.push("global");
    }
  }

  if (!primary && fallbacks.length > 0) {
    primary = fallbacks[0];
    fallbacks = fallbacks.slice(1);
    if (!sources.includes("system_fallback")) sources.push("system_fallback");
  }

  return { agent_id: agentId, primary, fallbacks, sources };
}

export function traceModelResolution({ agentId, primary, fallbacks, sources }) {
  return {
    trace_id: "model-assignment-resolution",
    timestamp: new Date().toISOString(),
    event: "model_assignment_resolved",
    actor: "alfred-core-model-assignment",
    data: {
      agent_id: agentId,
      primary,
      fallbacks,
      sources,
      provider_calls: 0
    }
  };
}

export function traceModelAssignmentConfigured({ targetPath = "~/.alfred/models.json", detectedModels = [], modelCount = 0, action = "preview" } = {}) {
  return {
    trace_id: "model-assignment-configuration",
    timestamp: new Date().toISOString(),
    event: "model_assignment_configured",
    actor: "alfred-core-model-assignment",
    data: {
      target_path: targetPath,
      action,
      detected_providers: [...new Set(detectedModels.map((model) => model.provider).filter(Boolean))],
      model_count: modelCount,
      provider_calls: 0
    }
  };
}

function firstDetectedByProvider(detectedModels, providers) {
  return providers.map((provider) => detectedModels.find((model) => model.provider === provider)).find(Boolean) ?? null;
}

function orderedFallbackModels(detectedModels) {
  const providerOrder = ["ollama", "openai", "gemini", "copilot", "anthropic"];
  const ordered = providerOrder.flatMap((provider) => detectedModels.filter((model) => model.provider === provider));
  const seen = new Set();
  return ordered
    .map((model) => model.model)
    .filter((model) => {
      if (!isValidModelId(model) || seen.has(model)) return false;
      seen.add(model);
      return true;
    });
}

export function buildSmartModelDefaults({ detectedModels = [], targetPath = "~/.alfred/models.json" } = {}) {
  const sanitized = detectedModels.filter((model) => model && isValidModelId(model.model) && typeof model.provider === "string");
  const fallbackChain = orderedFallbackModels(sanitized);
  const wildcard = firstDetectedByProvider(sanitized, ["ollama", "openai", "gemini", "copilot", "anthropic"]);
  const capable = firstDetectedByProvider(sanitized, ["anthropic", "openai", "copilot", "gemini", "ollama"]);
  const coding = firstDetectedByProvider(sanitized, ["anthropic", "openai", "copilot", "ollama", "gemini"]);

  const config = {};
  if (wildcard) {
    config["*"] = {
      primary: wildcard.model,
      fallbacks: fallbackChain.filter((model) => model !== wildcard.model)
    };
  }
  if (capable && capable.model !== config["*"]?.primary) config.orchestrator = { primary: capable.model };
  if (coding && coding.model !== config["*"]?.primary) config.developer = { primary: coding.model };
  config.fallbacks = fallbackChain;

  const validation = validateModelsConfig(config);
  return {
    config,
    detected_models: sanitized,
    validation,
    trace_event: traceModelAssignmentConfigured({
      targetPath,
      detectedModels: sanitized,
      modelCount: fallbackChain.length,
      action: "preview"
    }),
    provider_calls: 0
  };
}

export function resolveModelAssignment({
  agentId,
  creatorAgentId,
  harness,
  harnessModelBinding,
  profileManager,
  globalConfigPath = path.join(os.homedir(), ".alfred", "models.json")
}) {
  if (!agentId) throw new Error("agentId is required");

  const resolved = resolveModelAssignmentInternal({
    agentId,
    creatorAgentId,
    harness,
    harnessModelBinding,
    profileManager,
    globalConfigPath
  });

  const traceEvent = traceModelResolution({
    agentId: resolved.agent_id,
    primary: resolved.primary,
    fallbacks: resolved.fallbacks,
    sources: resolved.sources
  });

  return {
    agent_id: resolved.agent_id,
    primary: resolved.primary,
    fallbacks: resolved.fallbacks,
    sources: resolved.sources,
    trace_event: traceEvent,
    provider_calls: 0
  };
}
