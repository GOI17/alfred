#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCatalogEvent, createCatalogRequestCoordinator } from "./install-app.mjs";
import { CatalogError, fetchCatalog } from "./models-dev-catalog.mjs";
import { createPathfinderState, transition } from "./install-pathfinder.mjs";

const fixture = mkdtempSync(join(tmpdir(), "alfred-catalog-app-"));

function eventFile(name) {
  const directory = join(fixture, name);
  const file = join(directory, "catalog-events.jsonl");
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(file, "", { mode: 0o600 });
  return file;
}

function editorState() {
  let state = { ...createPathfinderState(), phase: "Configure" };
  state = transition(state, { type: "PATCH", key: "modelStrategy", value: "custom-models" });
  state = transition(state, { type: "OPEN_MODEL_EDITOR" });
  return state;
}

function consent(state, allow) {
  state = transition(state, { type: "OPEN_CATALOG" });
  if (allow) state = transition(state, { type: "FOCUS_CONTROL", control: "catalog-consent-allow" });
  return transition(state, { type: "ACTIVATE" });
}

function fixtureResult() {
  return {
    providers: [{ id: "openrouter", label: "OpenRouter", models: [{ id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" }] }],
    stats: { bytes: 1234, providers: 1, models: 1, duration_ms: 42 },
    metadata_requests: 1,
    provider_calls: 0
  };
}

try {
  let noRequestState = editorState();
  let noRequestCalls = 0;
  const noRequestEvents = eventFile("no-request");
  const noRequestCoordinator = createCatalogRequestCoordinator({
    eventsFile: noRequestEvents,
    fetchCatalogImpl: async () => { noRequestCalls += 1; return fixtureResult(); },
    onDispatch: (action) => { noRequestState = transition(noRequestState, action); }
  });
  noRequestState = transition(noRequestState, { type: "OPEN_CATALOG" });
  noRequestCoordinator.observe(noRequestState);
  await noRequestCoordinator.wait();
  assert.equal(noRequestCalls, 0, "opening consent never fetches");
  assert.equal(readFileSync(noRequestEvents, "utf8"), "", "opening consent writes no decision event");
  noRequestState = transition(noRequestState, { type: "ACTIVATE" });
  noRequestCoordinator.observe(noRequestState);
  assert.equal(noRequestCalls, 0, "declining never fetches");
  assert.deepEqual(JSON.parse(readFileSync(noRequestEvents, "utf8").trim()), { event: "catalog_consent_decided", consent: "declined" });
  noRequestState = transition(noRequestState, { type: "OPEN_CATALOG" });
  noRequestState = transition(noRequestState, { type: "ACTIVATE" });
  noRequestCoordinator.observe(noRequestState);
  assert.equal(readFileSync(noRequestEvents, "utf8").trim().split("\n").length, 1, "repeated declines may be deduplicated");
  noRequestState = transition(noRequestState, { type: "OPEN_CATALOG" });
  noRequestState = transition(noRequestState, { type: "FOCUS_CONTROL", control: "catalog-consent-allow" });
  noRequestState = transition(noRequestState, { type: "ACTIVATE" });
  noRequestCoordinator.observe(noRequestState);
  await noRequestCoordinator.wait();
  assert.equal(noRequestCalls, 1, "Decline, reopen, then Allow once starts one request");
  const reconsideredLines = readFileSync(noRequestEvents, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(reconsideredLines.map((event) => event.event === "catalog_consent_decided" ? event.consent : event.event), ["declined", "allowed", "catalog_fetch_completed"]);
  assert.equal(reconsideredLines[2].catalog_metadata_requests, 1);

  let successState = consent(editorState(), true);
  let successCalls = 0;
  const successEvents = eventFile("success");
  const successCoordinator = createCatalogRequestCoordinator({
    eventsFile: successEvents,
    fetchCatalogImpl: async ({ signal }) => {
      assert.equal(signal.aborted, false);
      successCalls += 1;
      return fixtureResult();
    },
    onDispatch: (action) => { successState = transition(successState, action); }
  });
  successCoordinator.observe(successState);
  successCoordinator.observe(successState);
  await successCoordinator.wait();
  successCoordinator.observe(successState);
  assert.equal(successCalls, 1, "explicit Allow once starts at most one fetch");
  assert.equal(successState.catalog.status, "success");
  assert.equal(successState.overlay?.type, "catalog-providers");
  const successText = readFileSync(successEvents, "utf8");
  const successLines = successText.trim().split("\n").map(JSON.parse);
  assert.deepEqual(successLines.map(({ event }) => event), ["catalog_consent_decided", "catalog_fetch_completed"]);
  assert.equal(successLines[1].outcome, "success");
  assert.equal(successLines[1].catalog_metadata_requests, 1);
  assert.doesNotMatch(successText, /openrouter|anthropic|sonnet|models\.dev|query|header|secret|path/i, "catalog events contain aggregates only");

  let errorState = consent(editorState(), true);
  const errorEvents = eventFile("error");
  const errorCoordinator = createCatalogRequestCoordinator({
    eventsFile: errorEvents,
    fetchCatalogImpl: async () => { throw new CatalogError("timeout", { metadataRequests: 1 }); },
    onDispatch: (action) => { errorState = transition(errorState, action); }
  });
  errorCoordinator.observe(errorState);
  await errorCoordinator.wait();
  assert.equal(errorState.catalog.status, "failure");
  assert.match(errorState.catalog.error, /timed out/i);
  assert.equal(JSON.parse(readFileSync(errorEvents, "utf8").trim().split("\n")[1]).outcome, "timeout");

  let cancelledState = consent(editorState(), true);
  const cancelEvents = eventFile("cancel");
  let abortObserved = false;
  const cancelCoordinator = createCatalogRequestCoordinator({
    eventsFile: cancelEvents,
    fetchCatalogImpl: ({ signal }) => new Promise((resolve, reject) => {
      if (signal.aborted) { abortObserved = true; reject(new CatalogError("aborted", { metadataRequests: 0 })); return; }
      signal.addEventListener("abort", () => { abortObserved = true; reject(new CatalogError("aborted", { metadataRequests: 1 })); }, { once: true });
    }),
    onDispatch: (action) => { cancelledState = transition(cancelledState, action); }
  });
  cancelCoordinator.observe(cancelledState);
  await Promise.resolve();
  cancelCoordinator.abort();
  await cancelCoordinator.wait();
  assert.equal(abortObserved, true, "cancel/SIGTERM integration can abort an in-flight catalog request");
  assert.equal(cancelledState.catalog.status, "failure");
  assert.equal(JSON.parse(readFileSync(cancelEvents, "utf8").trim().split("\n")[1]).outcome, "aborted");
  assert.equal(JSON.parse(readFileSync(cancelEvents, "utf8").trim().split("\n")[1]).catalog_metadata_requests, 1);

  let preRequestCancelledState = consent(editorState(), true);
  const preRequestCancelEvents = eventFile("cancel-before-request");
  let adapterCalls = 0;
  let fetchCalls = 0;
  const preRequestCancelCoordinator = createCatalogRequestCoordinator({
    eventsFile: preRequestCancelEvents,
    fetchCatalogImpl: ({ signal }) => {
      adapterCalls += 1;
      return fetchCatalog({
        signal,
        clock: () => 0,
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error("fetch must not start after cancellation");
        }
      });
    },
    onDispatch: (action) => { preRequestCancelledState = transition(preRequestCancelledState, action); }
  });
  preRequestCancelCoordinator.observe(preRequestCancelledState);
  preRequestCancelCoordinator.abort();
  assert.equal(adapterCalls, 0, "cancellation wins before the queued catalog adapter begins");
  await preRequestCancelCoordinator.wait();
  assert.equal(adapterCalls, 1, "the queued adapter observes the already-aborted signal");
  assert.equal(fetchCalls, 0, "the metadata fetch implementation never starts");
  assert.equal(preRequestCancelledState.catalog.status, "failure");
  const preRequestCancelLines = readFileSync(preRequestCancelEvents, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(preRequestCancelLines.map(({ event }) => event), ["catalog_consent_decided", "catalog_fetch_completed"]);
  assert.equal(preRequestCancelLines[0].consent, "allowed");
  assert.equal(preRequestCancelLines[1].outcome, "aborted-before-request");
  assert.equal(preRequestCancelLines[1].catalog_metadata_requests, 0);

  let traceFailureState = consent(editorState(), true);
  let traceFailureCalls = 0;
  const traceFailureEvents = eventFile("trace-failure");
  chmodSync(traceFailureEvents, 0o644);
  const traceFailureCoordinator = createCatalogRequestCoordinator({
    eventsFile: traceFailureEvents,
    fetchCatalogImpl: async () => { traceFailureCalls += 1; return fixtureResult(); },
    onDispatch: (action) => { traceFailureState = transition(traceFailureState, action); }
  });
  traceFailureCoordinator.observe(traceFailureState);
  await traceFailureCoordinator.wait();
  assert.equal(traceFailureCalls, 0, "audit append failure fails closed before network");
  assert.equal(traceFailureState.catalog.status, "failure");
  assert.match(traceFailureState.catalog.error, /audit recording failed/i);

  const unsafeDirectory = join(fixture, "unsafe");
  mkdirSync(unsafeDirectory, { mode: 0o700 });
  const outside = join(unsafeDirectory, "outside.jsonl");
  const link = join(unsafeDirectory, "catalog-events.jsonl");
  writeFileSync(outside, "", { mode: 0o600 });
  symlinkSync(outside, link);
  assert.throws(() => appendCatalogEvent(link, { event: "catalog_consent_decided", consent: "allowed" }), /not private/);
  assert.throws(() => appendCatalogEvent(successEvents, { event: "catalog_fetch_completed", outcome: "success", provider_id: "secret" }), /invalid catalog fetch event/);
  const emptyCompletion = {
    event: "catalog_fetch_completed",
    bytes_bucket: "none",
    provider_count_bucket: "none",
    model_count_bucket: "none",
    duration_bucket: "none"
  };
  assert.throws(() => appendCatalogEvent(eventFile("forged-pre-request"), { ...emptyCompletion, outcome: "aborted-before-request", catalog_metadata_requests: 1 }), /invalid catalog fetch event/);
  assert.throws(() => appendCatalogEvent(eventFile("forged-zero-request"), { ...emptyCompletion, outcome: "aborted", catalog_metadata_requests: 0 }), /invalid catalog fetch event/);

  console.log("install app catalog tests ok");
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
