import assert from "node:assert/strict";
import { test } from "node:test";
import { createInMemoryStore, createMemoryService, MemoryPolicy } from "../src/index.js";

const input = (content, candidate = {}, context = {}) => ({ candidate: { content, source: "user", ...candidate }, context: { evidence: content, origin: "user", ...context } });

test("capture creates grounded English and Spanish preferences without a remember command", async () => {
  const service = createMemoryService({ store: createInMemoryStore() });
  for (const content of ["Prefiero respuestas breves", "I prefer concise answers"]) {
    const result = await service.captureMemory("alice", input(content));
    assert.equal(result.status, "created");
    assert.equal(result.memory.type, "preference");
    assert.equal((await service.getMemory("alice", result.memory.id)).content, content);
    assert.deepEqual(result.memory.metadata, {});
    assert.equal(result.memory.context, undefined);
  }
});

test("policy rejects unsafe, uncertain, transient, opted-out, and ungrounded content before store access", async () => {
  const traces = [];
  const store = { list() { assert.fail("Rejected candidate read store"); }, create() { assert.fail("Rejected candidate wrote store"); } };
  const service = createMemoryService({ store, trace: (event) => traces.push(event) });
  const cases = [
    input("Perhaps the project uses tabs"), input("Quizá el proyecto usa tabs"),
    input("For this task I prefer concise answers"), input("I prefer tabs today"), input("Hoy prefiero respuestas breves"),
    input("The project token is ghp_abcdefghijklmnopqrstuvwxyz1234567890"),
    input("INFO service started successfully"), input("Mi contraseña es prueba"),
    input("El diagnóstico es reservado"), input("I prefer tabs", {}, { persistenceDisabled: true }),
    input("I prefer tabs", {}, { evidence: "Please do not persist this. I prefer tabs" }),
    input("Prefiero respuestas breves", {}, { evidence: "No quiero que guardes esto. Prefiero respuestas breves" }),
    input("Prefiero respuestas breves", {}, { evidence: "No lo recuerdes. Prefiero respuestas breves" }),
    input("I prefer tabs", {}, { evidence: "I prefer spaces" }),
    input("Okay", { type: "preference", tags: ["stable preference"] }),
    input("User: project uses tabs Assistant: okay"),
    input("I prefer tabs", { source: "password: test-value" })
  ];
  for (const value of cases) {
    const result = await service.captureMemory("alice", value);
    assert.equal(result.status, "skipped", value.context.evidence);
    assert.equal(result.memory, undefined);
    assert.ok(!JSON.stringify(result).includes(value.candidate.content));
  }
  const serialized = JSON.stringify(traces);
  for (const value of cases) assert.ok(!serialized.includes(value.candidate.content));
  assert.ok(traces.every((event) => event.payload.provider_calls === 0));
});

test("allowed type, source and unrelated context never rescue empty or ambiguous content", () => {
  const policy = new MemoryPolicy();
  assert.equal(policy.shouldPersist({ type: "preference", source: "workflow" }).allow, false);
  assert.equal(policy.shouldPersist({ content: "Okay", type: "preference", source: "project" }, { task: "Remember a preference" }).allow, false);
});

test("all supported categories recognize affirmative Spanish source statements", async () => {
  const service = createMemoryService({ store: createInMemoryStore() });
  for (const [content, type] of [
    ["Decidimos usar SQLite para el proyecto", "decision"],
    ["Procedimiento: ejecutar verificaciones antes de cada commit", "workflow"],
    ["Corrección: en adelante usa pnpm", "correction"],
    ["El repositorio utiliza módulos ESM", "project"],
    ["Referencia: https://example.org/documentacion", "source"],
    ["Hecho estable: el identificador es una cadena", "fact"]
  ]) {
    const result = await service.captureMemory("alice", input(content));
    assert.equal(result.status, "created", content);
    assert.equal(result.memory.type, type, content);
  }
});

test("capture validates strict fields and limits without echoing supplied contents", async () => {
  const service = createMemoryService({ store: createInMemoryStore() });
  for (const value of [null, {}, input(""), input("I prefer tabs", { metadata: { hidden: "private" } }), input("I prefer tabs", {}, { tenantId: "bob" }), input("I prefer tabs", {}, { origin: "guessed" }), input("x".repeat(1001))]) {
    await assert.rejects(service.captureMemory("alice", value), (error) => error.status === 400);
  }
  assert.equal((await service.listMemories("alice")).pagination.total, 0);
});

test("capture deduplicates beyond a page, across types and restarts, with tenant and namespace isolation", async () => {
  const store = createInMemoryStore();
  let service = createMemoryService({ store });
  const first = await service.captureMemory("alice", input("I prefer tabs", { namespace: "project:alfred" }));
  for (let i = 0; i < 110; i++) await service.createMemory("alice", { type: "fact", content: `filler ${i}`, source: "test", namespace: "project:alfred" });
  service = createMemoryService({ store });
  const repeated = await service.captureMemory("alice", input(" I  PREFER TABS ", { type: "fact", namespace: "project:alfred" }));
  assert.equal(repeated.status, "duplicate");
  assert.equal(repeated.memory.id, first.memory.id);
  assert.equal((await service.captureMemory("bob", input("I prefer tabs", { namespace: "project:alfred" }))).status, "created");
  assert.equal((await service.captureMemory("alice", input("I prefer tabs"))).status, "created");
});

test("concurrent captures sharing a store produce one write and independent services serialize", async () => {
  const store = createInMemoryStore();
  const results = await Promise.all(Array.from({ length: 10 }, () => createMemoryService({ store }).captureMemory("alice", input("I prefer tabs"))));
  assert.equal(results.filter((result) => result.status === "created").length, 1);
  assert.equal(results.filter((result) => result.status === "duplicate").length, 9);
});

test("store failures and missing write confirmations never become successful capture, and traces redact failures", async () => {
  for (const create of [async () => { throw new Error("sensitive exception content"); }, async () => undefined]) {
    const events = [];
    const store = { ...createInMemoryStore(), create };
    const service = createMemoryService({ store, trace: (event) => events.push(event) });
    await assert.rejects(service.captureMemory("alice", input("I prefer tabs")));
    assert.equal(events.at(-1).payload.outcome, "failed");
    assert.ok(!JSON.stringify(events).includes("sensitive exception content"));
    assert.ok(!events.some((event) => event.payload.outcome === "created"));
  }
});
