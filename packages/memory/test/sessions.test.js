import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionService,
  createInMemorySessionStore,
  createTopicService,
  createInMemoryTopicStore,
  createAcceptanceCriteriaService,
  createInMemoryACStore,
  deriveTopicRollup
} from "../src/index.js";

test("SessionService: create + list by tenant", async () => {
  const service = createSessionService({ store: createInMemorySessionStore() });
  const session = await service.createSession({
    tenant_id: "usr_t_a",
    title: "Onboarding",
    description: "Bring client up to speed."
  });
  assert.ok(session.id.startsWith("usr_s_"));
  assert.equal(session.status, "active");

  const list = await service.listSessionsByTenant("usr_t_a");
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].id, session.id);
});

test("SessionService: transition status", async () => {
  const service = createSessionService({ store: createInMemorySessionStore() });
  const s = await service.createSession({ tenant_id: "usr_t_b", title: "X" });
  const updated = await service.transitionSession(s.id, "paused");
  assert.equal(updated.status, "paused");
});

test("SessionService: rejects invalid status", async () => {
  const service = createSessionService({ store: createInMemorySessionStore() });
  await assert.rejects(
    () => service.createSession({ tenant_id: "usr_t_a", title: "x", status: "made_up" }),
    (err) => err.name === "SessionValidationError"
  );
});

test("TopicService: create + transition allowed", async () => {
  const sessionSvc = createSessionService({ store: createInMemorySessionStore() });
  const topicSvc = createTopicService({ store: createInMemoryTopicStore() });
  const s = await sessionSvc.createSession({ tenant_id: "usr_t_x", title: "Session" });
  const t = await topicSvc.createTopic({
    tenant_id: "usr_t_x", session_id: s.id, title: "Investigate"
  });
  assert.equal(t.status, "created");
  await topicSvc.transitionTopic(t.id, "pending");
  await topicSvc.transitionTopic(t.id, "in_progress");
  await topicSvc.transitionTopic(t.id, "completed");
  const final = await topicSvc.getTopic(t.id);
  assert.equal(final.status, "completed");
});

test("TopicService: rejects invalid transition completed -> in_progress", async () => {
  const sessionSvc = createSessionService({ store: createInMemorySessionStore() });
  const topicSvc = createTopicService({ store: createInMemoryTopicStore() });
  const s = await sessionSvc.createSession({ tenant_id: "usr_t_x", title: "Session" });
  const t = await topicSvc.createTopic({ tenant_id: "usr_t_x", session_id: s.id, title: "T" });
  // Walk forward then try to walk back.
  await topicSvc.transitionTopic(t.id, "in_progress");
  await topicSvc.transitionTopic(t.id, "completed");
  await assert.rejects(
    () => topicSvc.transitionTopic(t.id, "in_progress"),
    (err) => err.code === "topic_state_error"
  );
});

test("ACService: rollup computes by status", async () => {
  const acs = [
    { id: "a1", status: "completed" },
    { id: "a2", status: "completed" },
    { id: "a3", status: "in_progress" },
    { id: "a4", status: "pending" },
    { id: "a5", status: "cancelled" }
  ];
  const r = deriveTopicRollup(acs);
  assert.equal(r.total, 5);
  assert.equal(r.counts.completed, 2);
  assert.equal(r.counts.in_progress, 1);
  assert.equal(r.counts.pending, 1);
  assert.equal(r.counts.cancelled, 1);
  assert.equal(r.progressPct, 40);
});

test("ACService: create + list + transition", async () => {
  const sessionSvc = createSessionService({ store: createInMemorySessionStore() });
  const topicSvc = createTopicService({ store: createInMemoryTopicStore() });
  const acSvc = createAcceptanceCriteriaService({ store: createInMemoryACStore() });

  const s = await sessionSvc.createSession({ tenant_id: "usr_t_x", title: "S" });
  const t = await topicSvc.createTopic({ tenant_id: "usr_t_x", session_id: s.id, title: "T" });
  const ac = await acSvc.createAC({
    tenant_id: "usr_t_x",
    topic_id: t.id,
    description: "ship it"
  });
  assert.ok(ac.id.startsWith("usr_ac_"));

  const list = await acSvc.listACsByTopic(t.id);
  assert.equal(list.items.length, 1);

  const done = await acSvc.transitionAC(ac.id, "completed");
  assert.equal(done.status, "completed");
});

test("ACService: rejects unknown status", async () => {
  const service = createAcceptanceCriteriaService({ store: createInMemoryACStore() });
  await assert.rejects(
    () => service.createAC({ tenant_id: "t", topic_id: "top", description: "x", status: "made" }),
    (err) => err.name === "ACValidationError"
  );
});

test("End-to-end: session -> topic -> 3 ACs -> rollup", async () => {
  const sessionSvc = createSessionService({ store: createInMemorySessionStore() });
  const topicSvc = createTopicService({ store: createInMemoryTopicStore() });
  const acSvc = createAcceptanceCriteriaService({ store: createInMemoryACStore() });

  const s = await sessionSvc.createSession({ tenant_id: "usr_t_e2e", title: "E2E session" });
  const t = await topicSvc.createTopic({ tenant_id: "usr_t_e2e", session_id: s.id, title: "Investigate" });
  const ids = [];
  for (const desc of ["AC 1", "AC 2", "AC 3"]) {
    const ac = await acSvc.createAC({ tenant_id: "usr_t_e2e", topic_id: t.id, description: desc });
    ids.push(ac.id);
  }
  await acSvc.transitionAC(ids[0], "completed");
  await acSvc.transitionAC(ids[1], "in_progress");

  const list = await acSvc.listACsByTopic(t.id);
  const rollup = acSvc.rollup(list.items.map((a) => ({ status: a.status })));
  assert.equal(rollup.total, 3);
  assert.equal(rollup.counts.completed, 1);
  assert.equal(rollup.counts.in_progress, 1);
  assert.equal(rollup.counts.created, 1);
  assert.equal(rollup.progressPct, 33);
});
