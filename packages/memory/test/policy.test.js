import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { ALLOWED_MEMORY_TYPES, MemoryPolicy, createMemoryPolicy } from "../src/index.js";

describe("MemoryPolicy", () => {
  test("searches prior durable context with an auditable reason and useful query", () => {
    const policy = new MemoryPolicy();

    const decision = policy.shouldSearch({
      task: "Recall the previous architecture decision for packages/core before changing the adapter."
    });

    assert.equal(decision.allow, true);
    assert.match(decision.reason, /recall|prior|architecture/i);
    assert.equal(decision.query, "Recall the previous architecture decision for packages/core before changing the adapter.");
  });

  test("searches each approved durable-memory category", () => {
    const policy = new MemoryPolicy();
    const contexts = [
      "What preferences did the user share for TDD?",
      "Find the product decision about memory namespaces.",
      "Look up project history for the Pi adapter milestone.",
      "Recall the recurring workflow for package verification.",
      "Retrieve previous corrections before answering."
    ];

    for (const task of contexts) {
      const decision = policy.shouldSearch({ task });
      assert.equal(decision.allow, true, task);
      assert.equal(decision.query, task);
      assert.ok(decision.reason.length > 0);
    }
  });

  test("does not search for mechanical or signal-free tasks", () => {
    const policy = createMemoryPolicy();

    const mechanical = policy.shouldSearch({ task: "Run the memory package tests and show the result." });
    const empty = policy.shouldSearch({ task: "Add the missing semicolon in this file." });

    assert.equal(mechanical.allow, false);
    assert.match(mechanical.reason, /mechanical|self-contained/i);
    assert.equal(mechanical.query, undefined);
    assert.equal(empty.allow, false);
    assert.match(empty.reason, /no prior-memory signal|no durable memory signal/i);
  });

  test("persists only durable reusable memory and explains conservative denials", () => {
    const policy = new MemoryPolicy();

    const preference = policy.shouldPersist({
      content: "The user prefers strict TDD with one behavior test before implementation."
    });
    const decision = policy.shouldPersist({
      content: "Decision: packages/core remains harness-agnostic and adapters depend on core."
    });
    const source = policy.shouldPersist({
      content: "Source: https://example.com/docs is the useful reference for the memory API."
    });
    const transient = policy.shouldPersist({
      content: "The test server is currently running on port 49821 for this run."
    });
    const unsure = policy.shouldPersist({
      content: "Maybe useful later."
    });

    assert.equal(preference.allow, true);
    assert.match(preference.reason, /preference/i);
    assert.equal(decision.allow, true);
    assert.match(decision.reason, /decision/i);
    assert.equal(source.allow, true);
    assert.match(source.reason, /source/i);
    assert.equal(transient.allow, false);
    assert.match(transient.reason, /transient|temporary|log/i);
    assert.equal(unsure.allow, false);
    assert.match(unsure.reason, /not clearly durable|conservative/i);
  });

  test("rejects unsafe persistence candidates", () => {
    const policy = new MemoryPolicy();

    const unsafeCandidates = [
      "api_key = sk-test1234567890abcdef should never be persisted.",
      "SSN 123-45-6789 belongs to the user.",
      "User: hi\nAssistant: hello\nUser: raw transcript should not persist.",
      "Here is my chain-of-thought and hidden reasoning."
    ];

    for (const content of unsafeCandidates) {
      const decision = policy.shouldPersist({ content });
      assert.equal(decision.allow, false, content);
      assert.match(decision.reason, /secret|sensitive|transcript|reasoning|credential|personal/i);
    }
  });

  test("classifies candidates using only existing MemoryType values", () => {
    const policy = new MemoryPolicy();

    const samples = [
      [{ content: "The user prefers local-first tools." }, "preference"],
      [{ content: "Decision: use Pi.dev as the first adapter." }, "decision"],
      [{ content: "Workflow: run package checks before reporting." }, "workflow"],
      [{ content: "Correction: I was wrong; namespace validation belongs in domain." }, "correction"],
      [{ content: "Project fact: packages/memory owns memory persistence." }, "project"],
      [{ content: "Source: https://example.com/docs explains the API." }, "source"],
      [{ content: "Stable fact: memory IDs are strings." }, "fact"]
    ];

    for (const [candidate, expectedType] of samples) {
      const decision = policy.classify(candidate);
      assert.equal(decision.type, expectedType);
      assert.ok(ALLOWED_MEMORY_TYPES.includes(decision.type));
      assert.match(decision.reason, new RegExp(expectedType, "i"));
    }
  });

  test("suggests namespaces from explicit namespace, projectId, or personal fallback", () => {
    const policy = new MemoryPolicy();

    assert.deepEqual(policy.suggestNamespace({ namespace: "team:memory" }), {
      namespace: "team:memory",
      reason: "Using explicit namespace from context."
    });
    assert.deepEqual(policy.suggestNamespace({ projectId: "alfred" }), {
      namespace: "project:alfred",
      reason: "Using project namespace derived from projectId."
    });
    assert.deepEqual(policy.suggestNamespace({}), {
      namespace: "personal",
      reason: "Using personal namespace because no namespace or projectId was provided."
    });
  });

  test("is deterministic for equivalent inputs", () => {
    const policy = new MemoryPolicy();
    const context = {
      task: "Recall the reusable workflow for memory package verification.",
      namespace: "project:alfred"
    };
    const candidate = {
      content: "Workflow: run package-level checks before reporting.",
      source: "codex"
    };

    assert.deepEqual(policy.shouldSearch(context), policy.shouldSearch({ ...context }));
    assert.deepEqual(policy.shouldPersist(candidate, context), policy.shouldPersist({ ...candidate }, { ...context }));
    assert.deepEqual(policy.classify(candidate, context), policy.classify({ ...candidate }, { ...context }));
    assert.deepEqual(policy.suggestNamespace(context), policy.suggestNamespace({ ...context }));
  });

  test("always returns human-readable reasons", () => {
    const policy = new MemoryPolicy();
    const decisions = [
      policy.shouldSearch({ task: "Remember the user's testing preference." }),
      policy.shouldSearch({ task: "Format this one file." }),
      policy.shouldPersist({ content: "Decision: MemoryPolicy remains local-only." }),
      policy.shouldPersist({ content: "Temporary log output for this run." }),
      policy.classify({ content: "Source: https://example.com/docs" }),
      policy.suggestNamespace({ projectId: "alfred" })
    ];

    for (const decision of decisions) {
      assert.equal(typeof decision.reason, "string");
      assert.ok(decision.reason.trim().length > 0);
    }
  });
});
