import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildSmartModelDefaults,
  isValidModelId,
  resolveFallbacks,
  resolveModelAssignment,
  resolveTemporaryModel,
  traceModelAssignmentConfigured,
  traceModelResolution,
  validateModelBinding,
  validateModelsConfig
} from "../src/model-assignment.js";

function tmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(fn) {
  const dir = tmp("alfred-model-assignment-");
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("global * default is used when no agent-specific entry exists", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "models.json");
    writeJson(configPath, {
      "*": { primary: "claude-sonnet-4", fallbacks: ["gpt-4.1"] }
    });

    const result = resolveModelAssignment({ agentId: "reviewer", globalConfigPath: configPath });

    assert.equal(result.agent_id, "reviewer");
    assert.equal(result.primary, "claude-sonnet-4");
    assert.deepEqual(result.fallbacks, ["gpt-4.1"]);
    assert.deepEqual(result.sources, ["global"]);
    assert.equal(result.provider_calls, 0);
    assert.equal(result.trace_event.event, "model_assignment_resolved");
  });
});

test("agent-specific override wins over wildcard", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "models.json");
    writeJson(configPath, {
      "*": { primary: "claude-sonnet-4", fallbacks: ["gpt-4.1"] },
      developer: { primary: "claude-opus-4", fallbacks: ["claude-sonnet-4", "local-llama"] }
    });

    const result = resolveModelAssignment({ agentId: "developer", globalConfigPath: configPath });

    assert.equal(result.primary, "claude-opus-4");
    assert.deepEqual(result.fallbacks, ["claude-sonnet-4", "local-llama", "gpt-4.1"]);
    assert.ok(result.sources.includes("global"));
  });
});

test("profile overlay takes precedence over global config", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "models.json");
    writeJson(configPath, {
      "*": { primary: "claude-sonnet-4", fallbacks: ["gpt-4.1"] },
      developer: { primary: "claude-opus-4", fallbacks: ["local-llama"] }
    });

    const profileManager = {
      resolveModels(agentId) {
        if (agentId === "developer") {
          return { primary: "custom-dev-model", fallbacks: ["fallback-a"] };
        }
        return null;
      }
    };

    const result = resolveModelAssignment({
      agentId: "developer",
      profileManager,
      globalConfigPath: configPath
    });

    assert.equal(result.primary, "custom-dev-model");
    assert.deepEqual(result.fallbacks, ["fallback-a", "local-llama", "gpt-4.1"]);
    assert.ok(result.sources.includes("profile"));
    assert.ok(result.sources.includes("global"));
  });
});

test("harness override takes precedence over profile and global", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "models.json");
    writeJson(configPath, {
      "*": { primary: "claude-sonnet-4", fallbacks: ["gpt-4.1"] }
    });

    const profileManager = {
      resolveModels(agentId) {
        if (agentId === "developer") return { primary: "profile-model", fallbacks: [] };
        return null;
      }
    };

    const result = resolveModelAssignment({
      agentId: "developer",
      profileManager,
      harnessModelBinding: { developer: { primary: "harness-bound-model", fallbacks: ["harness-fallback"] } },
      globalConfigPath: configPath
    });

    assert.equal(result.primary, "harness-bound-model");
    assert.deepEqual(result.fallbacks, ["harness-fallback", "gpt-4.1"]);
    assert.ok(result.sources.includes("harness"));
  });
});

test("temporary agent inherits creator model assignment", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "models.json");
    writeJson(configPath, {
      "*": { primary: "claude-sonnet-4", fallbacks: ["gpt-4.1"] },
      developer: { primary: "claude-opus-4", fallbacks: ["local-llama"] }
    });

    const result = resolveModelAssignment({
      agentId: "temporary",
      creatorAgentId: "developer",
      globalConfigPath: configPath
    });

    assert.equal(result.primary, "claude-opus-4");
    assert.deepEqual(result.fallbacks, ["local-llama", "gpt-4.1"]);
    assert.ok(result.sources.includes("temporary_inheritance"));
  });
});

test("temporary:* overrides temporary inheritance", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "models.json");
    writeJson(configPath, {
      "*": { primary: "claude-sonnet-4", fallbacks: ["gpt-4.1"] },
      developer: { primary: "claude-opus-4", fallbacks: ["local-llama"] },
      "temporary:*": { primary: "claude-haiku", fallbacks: ["claude-sonnet-4"] }
    });

    const result = resolveModelAssignment({
      agentId: "temporary",
      creatorAgentId: "developer",
      globalConfigPath: configPath
    });

    assert.equal(result.primary, "claude-haiku");
    assert.deepEqual(result.fallbacks, ["claude-sonnet-4", "gpt-4.1"]);
    assert.ok(result.sources.includes("global"));
  });
});

test("temporary:creator override beats temporary:* and wildcard", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "models.json");
    writeJson(configPath, {
      "*": { primary: "claude-sonnet-4", fallbacks: ["gpt-4.1"] },
      "temporary:*": { primary: "claude-haiku", fallbacks: ["claude-sonnet-4"] },
      "temporary:developer": { primary: "custom-temp-model", fallbacks: ["fallback-b"] }
    });

    const result = resolveModelAssignment({
      agentId: "temporary",
      creatorAgentId: "developer",
      globalConfigPath: configPath
    });

    assert.equal(result.primary, "custom-temp-model");
    assert.deepEqual(result.fallbacks, ["fallback-b", "gpt-4.1"]);
  });
});

test("fallback chain merges agent-specific with global fallback chain", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "models.json");
    writeJson(configPath, {
      "*": { primary: "claude-sonnet-4", fallbacks: ["gpt-4.1"] },
      fallbacks: ["local-llama", "claude-sonnet-4"],
      developer: { primary: "claude-opus-4", fallbacks: ["claude-sonnet-4"] }
    });

    const result = resolveModelAssignment({ agentId: "developer", globalConfigPath: configPath });

    assert.equal(result.primary, "claude-opus-4");
    assert.deepEqual(result.fallbacks, ["claude-sonnet-4", "gpt-4.1", "local-llama"]);
  });
});

test("trace event is emitted on every resolution", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "models.json");
    writeJson(configPath, {
      "*": { primary: "claude-sonnet-4", fallbacks: [] }
    });

    const result = resolveModelAssignment({ agentId: "qa", globalConfigPath: configPath });

    assert.equal(result.trace_event.event, "model_assignment_resolved");
    assert.equal(result.trace_event.actor, "alfred-core-model-assignment");
    assert.equal(result.trace_event.data.agent_id, "qa");
    assert.equal(result.trace_event.data.primary, "claude-sonnet-4");
    assert.deepEqual(result.trace_event.data.fallbacks, []);
    assert.ok(Array.isArray(result.trace_event.data.sources));
    assert.equal(result.trace_event.data.provider_calls, 0);
  });
});

test("traceModelResolution helper produces the expected event shape", () => {
  const event = traceModelResolution({
    agentId: "orchestrator",
    primary: "claude-opus-4",
    fallbacks: ["claude-sonnet-4"],
    sources: ["global"]
  });

  assert.equal(event.event, "model_assignment_resolved");
  assert.equal(event.data.agent_id, "orchestrator");
  assert.equal(event.data.primary, "claude-opus-4");
  assert.deepEqual(event.data.fallbacks, ["claude-sonnet-4"]);
  assert.deepEqual(event.data.sources, ["global"]);
  assert.equal(event.data.provider_calls, 0);
});

test("resolveFallbacks merges without duplication", () => {
  const agentConfig = { fallbacks: ["a", "b"] };
  const globalFallbacks = ["b", "c"];
  assert.deepEqual(resolveFallbacks(agentConfig, globalFallbacks), ["a", "b", "c"]);
});

test("resolveTemporaryModel resolves temporary:* over temporary", () => {
  const globalModels = {
    temporary: { primary: "t-default", fallbacks: ["f1"] },
    "temporary:*": { primary: "t-star", fallbacks: ["f2"] },
    "temporary:developer": { primary: "t-dev", fallbacks: ["f3"] }
  };

  assert.equal(resolveTemporaryModel({ agentId: "temporary", creatorAgentId: "qa", globalModels }).primary, "t-star");
  assert.equal(
    resolveTemporaryModel({ agentId: "temporary", creatorAgentId: "developer", globalModels }).primary,
    "t-dev"
  );
});

test("missing primary falls back to wildcard primary", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "models.json");
    writeJson(configPath, {
      "*": { primary: "claude-sonnet-4", fallbacks: ["gpt-4.1"] },
      developer: { fallbacks: ["local-llama"] }
    });

    const result = resolveModelAssignment({ agentId: "developer", globalConfigPath: configPath });

    assert.equal(result.primary, "claude-sonnet-4");
    assert.deepEqual(result.fallbacks, ["local-llama", "gpt-4.1"]);
  });
});

test("missing primary falls back to first fallback when wildcard has no primary", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "models.json");
    writeJson(configPath, {
      fallbacks: ["local-llama"]
    });

    const result = resolveModelAssignment({ agentId: "qa", globalConfigPath: configPath });

    assert.equal(result.primary, "local-llama");
    assert.deepEqual(result.fallbacks, []);
  });
});

test("missing config returns empty result with trace", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "nonexistent", "models.json");
    const result = resolveModelAssignment({ agentId: "qa", globalConfigPath: configPath });

    assert.equal(result.agent_id, "qa");
    assert.equal(result.primary, null);
    assert.deepEqual(result.fallbacks, []);
    assert.equal(result.provider_calls, 0);
    assert.equal(result.trace_event.event, "model_assignment_resolved");
  });
});

test("provider-qualified model IDs are accepted as opaque strings", () => {
  fixture((dir) => {
    const configPath = path.join(dir, "models.json");
    writeJson(configPath, {
      "*": { primary: "anthropic/claude-sonnet-4", fallbacks: ["openai/gpt-4.1", "ollama/qwen2.5-coder:7b"] }
    });

    const result = resolveModelAssignment({ agentId: "architect", globalConfigPath: configPath });

    assert.equal(result.primary, "anthropic/claude-sonnet-4");
    assert.deepEqual(result.fallbacks, ["openai/gpt-4.1", "ollama/qwen2.5-coder:7b"]);
    assert.equal(isValidModelId("provider/model-name:tag"), true);
  });
});

test("lightweight validation reports invalid model config without provider calls", () => {
  const valid = validateModelsConfig({
    "*": { primary: "openai/gpt-4.1-mini", fallbacks: ["ollama/qwen2.5-coder:7b"] },
    fallbacks: ["anthropic/claude-sonnet-4"]
  });
  const invalid = validateModelsConfig({ developer: { primary: "", fallbacks: ["ok", ""] }, fallbacks: "nope" });
  const binding = validateModelBinding({ developer: { primary: "copilot/gpt-4.1", fallbacks: [] } });

  assert.equal(valid.status, "pass");
  assert.equal(valid.provider_calls, 0);
  assert.equal(binding.status, "pass");
  assert.equal(invalid.status, "fail");
  assert.ok(invalid.errors.some((error) => error.includes("developer.primary")));
  assert.ok(invalid.errors.some((error) => error.includes("fallbacks must be an array")));
  assert.equal(invalid.provider_calls, 0);
});

test("smart model defaults prefer local wildcard and capable per-agent overrides", () => {
  const result = buildSmartModelDefaults({
    detectedModels: [
      { provider: "openai", model: "openai/gpt-4.1-mini", source: "env:OPENAI_API_KEY" },
      { provider: "ollama", model: "ollama/qwen2.5-coder:7b", source: "socket:/var/run/ollama.sock" },
      { provider: "anthropic", model: "anthropic/claude-sonnet-4", source: "env:ANTHROPIC_API_KEY" }
    ]
  });

  assert.equal(result.config["*"].primary, "ollama/qwen2.5-coder:7b");
  assert.equal(result.config.orchestrator.primary, "anthropic/claude-sonnet-4");
  assert.equal(result.config.developer.primary, "anthropic/claude-sonnet-4");
  assert.deepEqual(result.config.fallbacks, ["ollama/qwen2.5-coder:7b", "openai/gpt-4.1-mini", "anthropic/claude-sonnet-4"]);
  assert.equal(result.validation.status, "pass");
  assert.equal(result.trace_event.event, "model_assignment_configured");
  assert.equal(result.provider_calls, 0);
});

test("model assignment configured trace records local-only configuration", () => {
  const event = traceModelAssignmentConfigured({
    targetPath: "/tmp/models.json",
    detectedModels: [{ provider: "gemini", model: "gemini/gemini-2.5-flash", source: "env:GEMINI_API_KEY" }],
    modelCount: 1,
    action: "write"
  });

  assert.equal(event.event, "model_assignment_configured");
  assert.equal(event.data.target_path, "/tmp/models.json");
  assert.deepEqual(event.data.detected_providers, ["gemini"]);
  assert.equal(event.data.provider_calls, 0);
});
