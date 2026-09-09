import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../src/index.html", import.meta.url), "utf8");
const dashboard = html.slice(html.indexOf("function escapeHtml(value)"), html.indexOf("async function loadAll()"));
const reset = html.slice(html.indexOf("function clearMemoryViews()"), html.indexOf("function showUnlockedState()"));
function harness(api) {
  const elements = new Map();
  const document = { hidden: false, getElementById(id) {
    if (!elements.has(id)) {
      let text = "", inner = "";
      elements.set(id, { value: "", disabled: false,
        get textContent() { return text; }, set textContent(v) { text = v; inner = ""; },
        get innerHTML() { return inner; }, set innerHTML(v) { inner = v; text = ""; }
      });
    }
    return elements.get(id);
  } };
  const timeouts = new Map(); let serial = 0; let poll;
  const create = new Function("document", "api", "setInterval", "setTimeout", "clearTimeout", `
    let API_KEY = "fixture", CURRENT_TENANT = "tenant", SESSION_VERSION = 0;
    let HISTORY_REQUEST = 0, ACTIVITY_REQUEST = 0, HISTORY_OFFSET = 0;
    let HISTORY_FILTERS = "", HISTORY_CONTROLLER = null, ACTIVITY_CONTROLLER = null;
    ${reset}
    ${dashboard}
    return { loadHistory, loadAgentActivity,
      logout() { API_KEY = ""; CURRENT_TENANT = ""; SESSION_VERSION++; clearMemoryViews(); },
      replaceCredential() { SESSION_VERSION++; clearMemoryViews(); },
      offset: () => HISTORY_OFFSET };
  `);
  const methods = create(document, api, (fn) => { poll = fn; }, (fn) => { timeouts.set(++serial, fn); return serial; }, (id) => timeouts.delete(id));
  return { ...methods, element: (id) => document.getElementById(id), poll: () => poll(), timeout: () => { for (const fn of timeouts.values()) fn(); } };
}
const result = (items = [], offset = 0, total = items.length) => ({ items, pagination: { offset, limit: 25, total } });
const memory = { id: "a", content: '<img src=x onerror="bad()">', type: "fact", namespace: "personal", source: "<script>bad()</script>", tags: ["<svg>"], createdAt: "2026-09-08T00:00:00Z" };
const activity = { items: [{ credential_id: "safe-id", credential_kind: "api_key", label: "<img onerror=bad()>", transport: "http", status: "connected", last_seen_at: "2026-09-08T00:00:00Z" }], observed_at: "2026-09-08T00:00:00Z" };

test("history requests bounded filters, safely renders content/metadata and navigates", async () => {
  const calls = [];
  const ui = harness(async (url, options) => { calls.push({ url, options }); return result([memory], calls.length === 1 ? 0 : 25, 26); });
  ui.element("historyNamespace").value = "project:alpha";
  ui.element("historyProject").value = "alpha";
  ui.element("historyType").value = "fact";
  await ui.loadHistory();
  const query = new URL(calls[0].url, "http://fixture").searchParams;
  assert.equal(query.get("limit"), "25"); assert.equal(query.get("namespace"), "project:alpha"); assert.equal(query.get("projectId"), "alpha");
  assert.equal(calls[0].options.cache, "no-store"); assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.match(ui.element("historyBody").innerHTML, /&lt;img/); assert.doesNotMatch(ui.element("historyBody").innerHTML, /<img|<script|<svg/);
  assert.equal(ui.element("historyNext").disabled, false);
  await ui.loadHistory(25);
  assert.equal(ui.offset(), 25); assert.equal(ui.element("historyNext").disabled, true); assert.equal(ui.element("historyPrevious").disabled, false);
});

test("edited filters reset page and disappearing records never produce reversed ranges", async () => {
  const calls = [];
  const ui = harness(async (url) => { calls.push(url); return calls.length < 3 ? result([memory], 0, 27) : result([], 25, 2); });
  await ui.loadHistory(0);
  ui.element("historyType").value = "decision";
  await ui.loadHistory(25);
  assert.equal(new URL(calls[1], "http://fixture").searchParams.get("offset"), "0");
  await ui.loadHistory(25);
  assert.match(ui.element("historyPage").textContent, /No memories on this page/);
  assert.doesNotMatch(ui.element("historyPage").textContent, /26.25/);
  assert.equal(ui.element("historyPrevious").disabled, false);
});

test("history distinguishes empty, loading and generic recoverable errors", async () => {
  let fail = false;
  const ui = harness(async () => { if (fail) throw new Error("PRIVATE FAILURE"); return result(); });
  await ui.loadHistory(); assert.match(ui.element("historyBody").textContent, /No saved memories/);
  fail = true; await ui.loadHistory();
  assert.match(ui.element("historyStatus").textContent, /retry/); assert.doesNotMatch(ui.element("historyStatus").textContent, /PRIVATE/);
});

test("late history response cannot cross logout, replacement or filter request generations", async () => {
  const pending = [];
  const ui = harness(() => new Promise((resolve) => pending.push(resolve)));
  const first = ui.loadHistory(); const second = ui.loadHistory();
  pending[1](result([{ ...memory, content: "NEW" }])); await second;
  pending[0](result([{ ...memory, content: "OLD" }])); await first;
  assert.match(ui.element("historyBody").innerHTML, /NEW/); assert.doesNotMatch(ui.element("historyBody").innerHTML, /OLD/);
  const after = ui.loadHistory(); ui.logout(); pending[2](result([memory])); await after;
  assert.equal(ui.element("historyBody").innerHTML, ""); assert.equal(ui.element("historyStatus").textContent, "");
});

test("activity is safe, clears old connections on failure, and empty activity is explicit", async () => {
  let response = activity;
  const ui = harness(async () => { if (!response) throw new Error("PRIVATE FAILURE"); return response; });
  await ui.loadAgentActivity(); assert.match(ui.element("agentsBody").innerHTML, /Connected — request open/);
  assert.doesNotMatch(ui.element("agentsBody").innerHTML, /<img/);
  response = null; await ui.loadAgentActivity();
  assert.equal(ui.element("agentsBody").innerHTML, ""); assert.match(ui.element("agentStatus").textContent, /unknown/);
  response = { ...activity, items: [] }; await ui.loadAgentActivity();
  assert.match(ui.element("agentsBody").textContent, /Registered API keys alone/);
});

test("automatic activity refresh does not starve slow requests and timeout reports unknown", async () => {
  let calls = 0; let resolve;
  const ui = harness((url, { signal }) => { calls++; return new Promise((yes, no) => { resolve = yes; signal.addEventListener("abort", () => no(new Error("aborted"))); }); });
  const first = ui.loadAgentActivity(); ui.poll(); ui.poll(); assert.equal(calls, 1);
  resolve(activity); await first; assert.match(ui.element("agentsBody").innerHTML, /Connected/);
  const second = ui.loadAgentActivity(); ui.timeout(); await second;
  assert.match(ui.element("agentStatus").textContent, /unknown/);
  assert.equal(ui.element("agentsBody").innerHTML, "");
});

test("logout and credential replacement abort activity and reject stale results", async () => {
  const pending = []; const signals = [];
  const ui = harness((url, { signal }) => { signals.push(signal); return new Promise((resolve) => pending.push(resolve)); });
  const first = ui.loadAgentActivity(); ui.replaceCredential();
  assert.equal(signals[0].aborted, true); pending[0](activity); await first;
  assert.equal(ui.element("agentsBody").innerHTML, "");
  const second = ui.loadAgentActivity(); ui.logout(); assert.equal(signals[1].aborted, true); pending[1](activity); await second;
  assert.equal(ui.element("agentsBody").innerHTML, ""); assert.equal(ui.element("agentStatus").textContent, "");
});
