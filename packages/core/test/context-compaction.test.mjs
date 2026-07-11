import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectContextUsage,
  resolveThreshold,
  summarizeWithHeuristics,
  compactContext
} from "../src/index.js";

function buildMessages(count, tokenPerMessage = 1000) {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: "x".repeat(tokenPerMessage * 4)
  }));
}

function staticEstimator(total) {
  return () => total;
}

test("detectContextUsage reports token ratio", () => {
  const messages = buildMessages(50, 1000);
  const usage = detectContextUsage({ messages, tokenEstimator: staticEstimator(50000) });
  assert.equal(usage.current_tokens, 50000);
  assert.equal(usage.model_context, 128000);
  assert.equal(usage.ratio, 50000 / 128000);
});

test("resolveThreshold uses global default when no overrides provided", () => {
  const result = resolveThreshold({ model_context: 100000 });
  assert.equal(result.threshold_ratio, 0.35);
  assert.equal(result.threshold_tokens, 35000);
  assert.deepEqual(result.sources, ["global_default"]);
});

test("resolveThreshold prefers profile override over global default", () => {
  const result = resolveThreshold({ model_context: 100000, globalDefault: 0.35, profileOverride: 0.5 });
  assert.equal(result.threshold_ratio, 0.5);
  assert.equal(result.threshold_tokens, 50000);
  assert.deepEqual(result.sources, ["global_default", "profile_override"]);
});

test("resolveThreshold prefers project override over profile override", () => {
  const projectIdentity = { origin_url: "https://example.com/repo.git", compaction_threshold: 0.6 };
  const result = resolveThreshold({
    model_context: 100000,
    globalDefault: 0.35,
    profileOverride: 0.5,
    projectIdentity
  });
  assert.equal(result.threshold_ratio, 0.6);
  assert.equal(result.threshold_tokens, 60000);
  assert.deepEqual(result.sources, ["global_default", "profile_override", "project_override"]);
});

test("resolveThreshold ignores invalid overrides", () => {
  const result = resolveThreshold({ model_context: 100000, globalDefault: 0.35, profileOverride: 1.5 });
  assert.equal(result.threshold_ratio, 0.35);
  assert.deepEqual(result.sources, ["global_default"]);
});

test("summarizeWithHeuristics keeps system messages and recent turns", () => {
  const messages = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "first question" },
    { role: "assistant", content: "first answer" },
    ...buildMessages(20, 1000),
    { role: "user", content: "latest question" }
  ];
  const summary = summarizeWithHeuristics(messages, 30000);
  assert.ok(summary.some((message) => message.role === "system"));
  assert.ok(summary.some((message) => message.content === "latest question"));
  assert.ok(summary.length < messages.length);
});

test("compactContext uses local heuristics and emits provider_request_avoided", async () => {
  const messages = buildMessages(20, 1000);
  const result = await compactContext({ messages, targetTokens: 30000, projectIdentity: {} });
  assert.ok(Array.isArray(result.summary_messages));
  assert.equal(result.provider_calls, 0);
  assert.ok(result.trace_events.includes("context_compaction_triggered"));
  assert.ok(result.trace_events.includes("provider_request_avoided"));
});

test("compactContext does not call provider without approval", async () => {
  const messages = buildMessages(200, 1000);
  const providerGateway = { summarize: () => [{ role: "assistant", content: "summary" }] };
  const result = await compactContext({
    messages,
    targetTokens: 1000,
    projectIdentity: {},
    providerGateway,
    approval: false
  });
  assert.equal(result.provider_calls, 0);
  assert.ok(result.trace_events.includes("provider_request_avoided"));
});

test("compactContext uses provider fallback only with approval", async () => {
  const messages = buildMessages(500, 1000);
  const providerGateway = { summarize: () => [{ role: "assistant", content: "provider summary" }] };
  const result = await compactContext({
    messages,
    targetTokens: 100,
    projectIdentity: {},
    providerGateway,
    approval: true
  });
  assert.equal(result.provider_calls, 1);
  assert.ok(result.trace_events.includes("provider_request_reduced"));
  assert.ok(result.summary_messages.some((message) => message.content === "provider summary"));
});

test("compactContext writes trace events to local trace dir in local-only mode", async () => {
  const messages = buildMessages(20, 1000);
  const result = await compactContext({ messages, targetTokens: 30000, projectIdentity: {} });
  assert.equal(result.provider_calls, 0);
  assert.ok(result.trace_events.length >= 2);
});
