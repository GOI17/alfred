import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createAgentActivity, observeAgentRequest } from "../src/agent-activity.js";

const EPOCH = Date.parse("2026-09-08T12:00:00.000Z");
function setup(options = {}) {
  let time = EPOCH;
  const activity = createAgentActivity({ now: () => time, ...options });
  return { activity, advance(ms) { time += ms; } };
}
const identity = (overrides = {}) => ({
  tenantId: "tenant-a", credentialId: "key-a", credentialKind: "api_key", transport: "http", ...overrides
});
const one = (activity, tenant = "tenant-a") => {
  const items = activity.list(tenant).items;
  assert.equal(items.length, 1);
  return items[0];
};

test("presence starts empty and does not infer registered agents or other tenants", () => {
  const { activity } = setup();
  assert.deepEqual(activity.list("tenant-a").items, []);
  activity.start(identity());
  assert.deepEqual(activity.list("tenant-b").items, []);
  assert.equal(one(activity).status, "connected");
});

test("observed connection exposes useful bounded metadata without credentials", () => {
  const { activity } = setup();
  activity.start(identity({ apiKey: "alk_should_never_be_serialized", workspaceId: "untrusted-workspace" }));
  const result = activity.list("tenant-a");
  assert.equal(result.scope, "server_process");
  assert.equal(result.recent_window_ms, 60_000);
  assert.equal(result.observed_at, new Date(EPOCH).toISOString());
  const row = one(activity);
  assert.equal(row.credential_id, "key-a");
  assert.equal(row.credential_kind, "api_key");
  assert.equal(row.transport, "http");
  assert.equal(row.active_requests, 1);
  assert.equal(row.workspace_id, null, "workspace is unknown without a trusted binding");
  assert.equal(row.first_seen_at, new Date(EPOCH).toISOString());
  assert.equal(row.last_seen_at, new Date(EPOCH).toISOString());
  assert.doesNotMatch(JSON.stringify(result), /alk_should_never_be_serialized|untrusted-workspace/);
});

test("completion is recently active, then inactive exactly at the freshness boundary", () => {
  const { activity, advance } = setup();
  const finish = activity.start(identity());
  advance(1_000);
  finish();
  let row = one(activity);
  assert.equal(row.status, "recently_active");
  assert.equal(row.last_outcome, "completed");
  assert.equal(row.active_requests, 0);
  assert.equal(row.last_seen_at, new Date(EPOCH + 1_000).toISOString());
  advance(59_999);
  assert.equal(one(activity).status, "recently_active");
  advance(1);
  assert.equal(one(activity).status, "inactive");
});

test("concurrent requests stay connected until the final completion and finish is idempotent", () => {
  const { activity, advance } = setup();
  const first = activity.start(identity());
  advance(1);
  const second = activity.start(identity());
  assert.equal(one(activity).active_requests, 2);
  first();
  first();
  assert.equal(one(activity).active_requests, 1);
  assert.equal(one(activity).status, "connected");
  second();
  assert.equal(one(activity).active_requests, 0);
  assert.equal(one(activity).status, "recently_active");
});

test("abort is disconnected, failed requests record real activity, and later requests reconnect", () => {
  const { activity, advance } = setup();
  activity.start(identity())("aborted");
  assert.equal(one(activity).status, "disconnected");
  assert.equal(one(activity).last_outcome, "aborted");
  advance(1);
  const finish = activity.start(identity());
  assert.equal(one(activity).status, "connected");
  finish("failed");
  assert.equal(one(activity).status, "recently_active");
  assert.equal(one(activity).last_outcome, "failed");
});

test("abort of one concurrent request does not disconnect another active request", () => {
  const { activity } = setup();
  const first = activity.start(identity());
  const second = activity.start(identity());
  first("aborted");
  assert.equal(one(activity).status, "connected");
  assert.equal(one(activity).active_requests, 1);
  second();
  assert.equal(one(activity).status, "recently_active");
});

test("request leases expire so a missing close cannot keep an agent connected forever", () => {
  const { activity, advance } = setup();
  activity.start(identity());
  advance(299_999);
  assert.equal(one(activity).status, "connected");
  advance(1);
  const row = one(activity);
  assert.equal(row.status, "inactive");
  assert.equal(row.active_requests, 0);
  assert.equal(row.last_outcome, "expired");
  assert.equal(row.last_seen_at, new Date(EPOCH).toISOString());
});

test("individual request leases preserve newer concurrent work", () => {
  const { activity, advance } = setup();
  activity.start(identity());
  advance(200_000);
  const second = activity.start(identity());
  advance(100_000);
  assert.equal(one(activity).status, "connected");
  assert.equal(one(activity).active_requests, 1);
  second();
  assert.equal(one(activity).status, "recently_active");
});

test("tenant, credential kind, credential id and transport form distinct observed identities", () => {
  const { activity } = setup();
  for (const options of [{}, { credentialKind: "oauth_client" }, { credentialId: "key-b" }, { transport: "mcp" }, { tenantId: "tenant-b" }]) {
    activity.start(identity(options));
  }
  assert.equal(activity.list("tenant-a").items.length, 4);
  assert.equal(new Set(activity.list("tenant-a").items.map((item) => item.id)).size, 4);
  assert.equal(activity.list("tenant-b").items.length, 1);
});

test("identity delimiters cannot collide across tenant boundaries", () => {
  const { activity } = setup();
  activity.start(identity({ tenantId: "tenant:a", credentialId: "key" }));
  activity.start(identity({ tenantId: "tenant", credentialId: "a:key" }));
  assert.equal(one(activity, "tenant:a").credential_id, "key");
  assert.equal(one(activity, "tenant").credential_id, "a:key");
});

test("retention removes old observations without persisting disconnected identities forever", () => {
  const { activity, advance } = setup();
  activity.start(identity())();
  advance(86_400_000);
  assert.deepEqual(activity.list("tenant-a").items, []);
});

test("bounded observer evicts inactive entries while preserving active observations", () => {
  const { activity, advance } = setup({ maxEntries: 2 });
  activity.start(identity({ credentialId: "old" }))();
  advance(60_000);
  activity.start(identity({ credentialId: "active" }));
  advance(1);
  activity.start(identity({ credentialId: "new" }));
  const ids = activity.list("tenant-a").items.map((item) => item.credential_id).sort();
  assert.deepEqual(ids, ["active", "new"]);
});

test("capacity full of active requests drops new observations instead of fabricating disconnection", () => {
  const { activity } = setup({ maxEntries: 1 });
  activity.start(identity());
  const ignoredFinish = activity.start(identity({ credentialId: "key-b" }));
  assert.equal(typeof ignoredFinish, "function");
  assert.doesNotThrow(() => ignoredFinish());
  assert.equal(one(activity).credential_id, "key-a");
  assert.equal(one(activity).status, "connected");
});

test("observer snapshots cannot mutate internal presence state", () => {
  const { activity } = setup();
  activity.start(identity());
  const row = one(activity);
  row.credential_id = "tampered";
  row.active_requests = 999;
  assert.equal(one(activity).credential_id, "key-a");
  assert.equal(one(activity).active_requests, 1);
});


test("per-identity active request cap bounds memory while preserving tracked requests", () => {
  const { activity } = setup({ maxActiveRequests: 2 });
  const first = activity.start(identity());
  activity.start(identity());
  const dropped = activity.start(identity());
  assert.equal(one(activity).active_requests, 2);
  dropped();
  assert.equal(one(activity).active_requests, 2);
  first();
  activity.start(identity());
  assert.equal(one(activity).active_requests, 2);
  assert.equal(activity.list("tenant-a").max_active_requests, 2);
});

test("late request completion cannot revive an expired lease even without intervening polling", () => {
  const { activity, advance } = setup();
  const finish = activity.start(identity());
  advance(300_000);
  finish();
  assert.equal(one(activity).status, "inactive");
  assert.equal(one(activity).last_outcome, "expired");
  assert.equal(one(activity).last_seen_at, new Date(EPOCH).toISOString());
});

test("trace failures do not affect presence and emitted events exclude credential material", async () => {
  const events = [];
  const { activity } = setup({ trace(event) { events.push(event); return Promise.reject(new Error("trace unavailable")); } });
  activity.start(identity())();
  await Promise.resolve();
  assert.equal(one(activity).status, "recently_active");
  assert.equal(events.length, 2);
  assert.equal(events[0].payload.provider_calls, 0);
  assert.doesNotMatch(JSON.stringify(events), /key-a|credential/);
});


function requestPair() {
  const req = new EventEmitter();
  const res = new EventEmitter();
  res.statusCode = 200;
  res.writableEnded = false;
  return { req, res };
}
function assertReleased(req, res) {
  for (const name of ["aborted", "error"]) assert.equal(req.listenerCount(name), 0, `request ${name} listener released`);
  for (const name of ["finish", "close", "error"]) assert.equal(res.listenerCount(name), 0, `response ${name} listener released`);
}

test("real response finish releases the observation and every lifecycle listener", () => {
  const { activity } = setup();
  const { req, res } = requestPair();
  observeAgentRequest(activity, identity(), req, res);
  assert.equal(one(activity).status, "connected");
  res.writableEnded = true;
  res.emit("finish");
  assert.equal(one(activity).status, "recently_active");
  assert.equal(one(activity).last_outcome, "completed");
  assertReleased(req, res);
  res.emit("close");
  assert.equal(one(activity).active_requests, 0);
});

test("HTTP error response completion records failure rather than active connection", () => {
  const { activity } = setup();
  const { req, res } = requestPair();
  observeAgentRequest(activity, identity(), req, res);
  res.statusCode = 503;
  res.emit("finish");
  assert.equal(one(activity).last_outcome, "failed");
  assert.equal(one(activity).active_requests, 0);
  assertReleased(req, res);
});

test("response close distinguishes complete requests from interrupted transports", () => {
  for (const complete of [true, false]) {
    const { activity } = setup();
    const { req, res } = requestPair();
    observeAgentRequest(activity, identity(), req, res);
    res.writableEnded = complete;
    res.emit("close");
    assert.equal(one(activity).status, complete ? "recently_active" : "disconnected");
    assertReleased(req, res);
  }
});

test("request abort and request or response error release connection state safely", () => {
  for (const [side, name] of [["req", "aborted"], ["req", "error"], ["res", "error"]]) {
    const { activity } = setup();
    const pair = requestPair();
    observeAgentRequest(activity, identity(), pair.req, pair.res);
    pair[side].emit(name, new Error("synthetic transport failure"));
    assert.equal(one(activity).status, "disconnected");
    assert.equal(one(activity).last_outcome, "aborted");
    assertReleased(pair.req, pair.res);
  }
});

test("already aborted requests or destroyed responses never create ghost connections", () => {
  for (const side of ["req", "res"]) {
    const { activity } = setup();
    const { req, res } = requestPair();
    if (side === "req") req.aborted = true;
    else res.destroyed = true;
    observeAgentRequest(activity, identity(), req, res)();
    assert.deepEqual(activity.list("tenant-a").items, []);
    assertReleased(req, res);
  }
});

test("explicit completion is idempotent with subsequent transport notifications", () => {
  const { activity } = setup();
  const { req, res } = requestPair();
  const end = observeAgentRequest(activity, identity(), req, res);
  end("failed");
  end("completed");
  res.emit("finish");
  res.emit("close");
  assert.equal(one(activity).last_outcome, "failed");
  assert.equal(one(activity).active_requests, 0);
  assertReleased(req, res);
});
