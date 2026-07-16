#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_ERROR_CATEGORIES,
  CATALOG_LIMITS,
  CATALOG_URL,
  CatalogError,
  DEFAULT_MAX_BYTES,
  DEFAULT_TIMEOUT_MS,
  MAX_LABEL_CODE_POINTS,
  MAX_JSON_CONTAINERS,
  MAX_JSON_NESTING_DEPTH,
  MAX_JSON_OBJECT_MEMBERS,
  MAX_JSON_STRUCTURAL_TOKENS,
  MAX_MODELS_PER_PROVIDER,
  MAX_MODEL_ID_CODE_POINTS,
  MAX_PROVIDERS,
  MAX_PROVIDER_ID_CODE_POINTS,
  MAX_TOTAL_MODELS,
  catalogErrorCategory,
  extractCatalog,
  fetchCatalog,
  getCatalogErrorCategory,
  isCatalogError
} from "./models-dev-catalog.mjs";

const encoder = new TextEncoder();

function model(id, name = id, extra = {}) {
  return { id, name, ...extra };
}

function provider(id, models = { main: model("main", "Main") }, name = id, extra = {}) {
  return { id, name, models, ...extra };
}

function fixtureCatalog() {
  return {
    openrouter: provider("openrouter", {
      sonnet: model("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6")
    }, "OpenRouter")
  };
}

function nearLimitTinyProviderMap() {
  const targetBytes = DEFAULT_MAX_BYTES - 64 * 1024;
  const entries = [];
  let bytes = 2;
  for (let index = 0; bytes < targetBytes; index += 1) {
    const entry = `${index === 0 ? "" : ","}\"p${index}\":{\"id\":\"p${index}\",\"models\":{}}`;
    entries.push(entry);
    bytes += entry.length;
  }
  const text = `{${entries.join("")}}`;
  assert.ok(text.length < DEFAULT_MAX_BYTES);
  assert.ok(text.length >= targetBytes);
  return JSON.parse(text);
}

function bodyFromChunks(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
}

function responseFromBytes(bytes, options = {}) {
  const headers = new Headers(options.headers ?? { "content-type": "application/json" });
  return {
    status: options.status ?? 200,
    url: options.url ?? CATALOG_URL,
    redirected: options.redirected ?? false,
    headers,
    body: options.body ?? bodyFromChunks(options.chunks ?? [bytes]),
    text() { throw new Error("response.text() must never be used"); }
  };
}

function responseFromJson(json, options = {}) {
  const bytes = encoder.encode(JSON.stringify(json));
  const headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  if (options.withContentLength !== false && !Object.hasOwn(headers, "content-length")) headers["content-length"] = String(bytes.byteLength);
  return responseFromBytes(bytes, { ...options, headers });
}

function responseFromText(text, options = {}) {
  const bytes = encoder.encode(text);
  const headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  if (options.withContentLength !== false && !Object.hasOwn(headers, "content-length")) headers["content-length"] = String(bytes.byteLength);
  return responseFromBytes(bytes, { ...options, headers });
}

function trackedResponseFromBytes(bytes, options = {}) {
  const state = { bodyCancels: 0, readerCancels: 0 };
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of options.chunks ?? [bytes]) controller.enqueue(chunk);
      if (options.close !== false) controller.close();
    }
  });
  const body = {
    getReader() {
      const reader = stream.getReader();
      return {
        read: () => reader.read(),
        cancel: () => {
          state.readerCancels += 1;
          return reader.cancel();
        },
        releaseLock: () => reader.releaseLock()
      };
    },
    cancel() {
      state.bodyCancels += 1;
      return stream.cancel();
    }
  };
  return { response: responseFromBytes(bytes, { ...options, body }), state };
}

function trackedFailingReaderResponse() {
  const state = { bodyCancels: 0, readerCancels: 0 };
  const body = {
    getReader() {
      return {
        read: async () => { throw new Error("stream failed"); },
        cancel: () => {
          state.readerCancels += 1;
          return Promise.reject(new Error("cancel failed"));
        },
        releaseLock() {}
      };
    },
    cancel() {
      state.bodyCancels += 1;
      throw new Error("body cancel failed");
    }
  };
  return {
    response: responseFromBytes(new Uint8Array(), { body }),
    state
  };
}

async function expectCleanedPostFetchRejection({ response, state }, category, options = {}) {
  let requestSignal;
  await expectCategory(fetchCatalog({
    fetchImpl: async (_url, init) => {
      requestSignal = init.signal;
      return response;
    },
    clock: () => 0,
    ...options
  }), category);
  assert.equal(requestSignal.aborted, true, `${category} rejection must abort its request`);
  assert.equal(state.bodyCancels + state.readerCancels, 1, `${category} rejection must cancel exactly one body handle`);
}

async function expectCategory(promise, category, metadataRequests = 1) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof CatalogError);
    assert.equal(isCatalogError(error), true);
    assert.equal(error.category, category);
    assert.equal(catalogErrorCategory(error), category);
    assert.equal(getCatalogErrorCategory(error), category);
    assert.equal(error.metadata_requests, metadataRequests);
    assert.equal(error.provider_calls, 0);
    assert.doesNotMatch(error.message, /https?:|secret|authorization|cookie/i);
    return true;
  });
}

test("exports the exact endpoint and catalog limits", () => {
  assert.equal(CATALOG_URL, "https://models.dev/api.json");
  assert.equal(DEFAULT_TIMEOUT_MS, 5_000);
  assert.equal(DEFAULT_MAX_BYTES, 8 * 1024 * 1024);
  assert.equal(MAX_PROVIDERS, 512);
  assert.equal(MAX_MODELS_PER_PROVIDER, 4_096);
  assert.equal(MAX_TOTAL_MODELS, 12_000);
  assert.equal(MAX_PROVIDER_ID_CODE_POINTS, 128);
  assert.equal(MAX_MODEL_ID_CODE_POINTS, 512);
  assert.equal(MAX_LABEL_CODE_POINTS, 256);
  assert.equal(MAX_JSON_NESTING_DEPTH, 32);
  assert.equal(MAX_JSON_CONTAINERS, 100_000);
  assert.equal(MAX_JSON_STRUCTURAL_TOKENS, 750_000);
  assert.equal(MAX_JSON_OBJECT_MEMBERS, 250_000);
  assert.deepEqual(CATALOG_LIMITS, {
    providers: 512,
    models_per_provider: 4_096,
    total_models: 12_000,
    provider_id_code_points: 128,
    model_id_code_points: 512,
    label_code_points: 256,
    json_nesting_depth: 32,
    json_containers: 100_000,
    json_structural_tokens: 750_000,
    json_object_members: 250_000
  });
  assert.ok(Object.isFrozen(CATALOG_LIMITS));
  assert.equal(CATALOG_ERROR_CATEGORIES.includes("declined"), false, "decline remains TUI-owned");
  assert.deepEqual(CATALOG_ERROR_CATEGORIES, ["timeout", "aborted", "network", "http", "redirect", "content-type", "oversized", "malformed", "schema"]);
  assert.equal(catalogErrorCategory(new Error("secret detail")), "network");
});

test("fetches once with an exact credential-free GET and bounded stats", async () => {
  const calls = [];
  const clockValues = [100, 107.5];
  const result = await fetchCatalog({
    fetchImpl: async (...args) => {
      calls.push(args);
      return responseFromJson(fixtureCatalog(), { withContentLength: false });
    },
    clock: () => clockValues.shift()
  });

  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, "https://models.dev/api.json");
  assert.equal(init.method, "GET");
  assert.equal(init.redirect, "manual");
  assert.equal(init.credentials, "omit");
  assert.equal(init.referrer, "");
  assert.equal(init.referrerPolicy, "no-referrer");
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(init.headers, { Accept: "application/json" });
  assert.deepEqual(Object.keys(init.headers), ["Accept"]);
  assert.equal(Object.hasOwn(init.headers, "Authorization"), false);
  assert.equal(Object.hasOwn(init.headers, "Cookie"), false);
  assert.equal(result.providers[0].models[0].id, "anthropic/claude-sonnet-4.6");
  assert.deepEqual(result.stats, {
    bytes: encoder.encode(JSON.stringify(fixtureCatalog())).byteLength,
    providers: 1,
    models: 1,
    duration_ms: 7.5
  });
  assert.equal(result.metadata_requests, 1);
  assert.equal(result.provider_calls, 0);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.stats));
});

test("does not retry network failures or retain their details", async () => {
  let calls = 0;
  await expectCategory(fetchCatalog({
    fetchImpl: async () => {
      calls += 1;
      throw new Error("secret=https://credential@example.invalid");
    },
    clock: () => 0
  }), "network");
  assert.equal(calls, 1);
});

test("rejects redirects and any response URL mismatch", async () => {
  await expectCategory(fetchCatalog({
    fetchImpl: async () => responseFromJson(fixtureCatalog(), { status: 302, url: CATALOG_URL }),
    clock: () => 0
  }), "redirect");
  await expectCategory(fetchCatalog({
    fetchImpl: async () => responseFromJson(fixtureCatalog(), { url: "https://models.dev/other.json" }),
    clock: () => 0
  }), "redirect");
  await expectCategory(fetchCatalog({
    fetchImpl: async () => responseFromJson(fixtureCatalog(), { redirected: true }),
    clock: () => 0
  }), "redirect");
});

test("classifies timeout and parent abort without retrying", async () => {
  let timeoutCalls = 0;
  await expectCategory(fetchCatalog({
    fetchImpl: async (_url, { signal }) => {
      timeoutCalls += 1;
      return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    },
    clock: () => 0,
    timeoutMs: 5
  }), "timeout");
  assert.equal(timeoutCalls, 1);

  const parent = new AbortController();
  let abortCalls = 0;
  await expectCategory(fetchCatalog({
    fetchImpl: async () => {
      abortCalls += 1;
      parent.abort();
      return new Promise(() => {});
    },
    clock: () => 0,
    signal: parent.signal
  }), "aborted");
  assert.equal(abortCalls, 1);

  const preAborted = new AbortController();
  preAborted.abort();
  let preAbortedCalls = 0;
  await expectCategory(fetchCatalog({
    fetchImpl: async () => { preAbortedCalls += 1; },
    clock: () => 0,
    signal: preAborted.signal
  }), "aborted", 0);
  assert.equal(preAbortedCalls, 0);
});

test("requires status 200 and an application/json media type", async () => {
  for (const status of [0, 201, 404, 500]) {
    await expectCategory(fetchCatalog({
      fetchImpl: async () => responseFromJson(fixtureCatalog(), { status }),
      clock: () => 0
    }), "http");
  }
  for (const contentType of [undefined, "", "text/json", "application/jsonp", "text/html"]) {
    await expectCategory(fetchCatalog({
      fetchImpl: async () => responseFromJson(fixtureCatalog(), {
        headers: contentType === undefined ? { "content-type": null } : { "content-type": contentType }
      }),
      clock: () => 0
    }), "content-type");
  }
  const accepted = await fetchCatalog({
    fetchImpl: async () => responseFromJson(fixtureCatalog(), { headers: { "content-type": "Application/JSON; charset=utf-8" } }),
    clock: () => 0
  });
  assert.equal(accepted.stats.providers, 1);
});

test("validates declared length and enforces the streamed byte limit when absent or false", async () => {
  for (const contentLength of ["", "-1", "1.5", "1, 1", "not-a-number"]) {
    await expectCategory(fetchCatalog({
      fetchImpl: async () => responseFromJson(fixtureCatalog(), { headers: { "content-length": contentLength } }),
      clock: () => 0
    }), "malformed");
  }
  await expectCategory(fetchCatalog({
    fetchImpl: async () => responseFromJson(fixtureCatalog(), { headers: { "content-length": "101" } }),
    clock: () => 0,
    maxBytes: 100
  }), "oversized");

  const exactBytes = encoder.encode(JSON.stringify(fixtureCatalog()));
  const exactLimit = await fetchCatalog({
    fetchImpl: async () => responseFromBytes(exactBytes, { headers: { "content-type": "application/json", "content-length": String(exactBytes.byteLength) } }),
    clock: () => 0,
    maxBytes: exactBytes.byteLength
  });
  assert.equal(exactLimit.stats.bytes, exactBytes.byteLength);

  const overLimit = new Uint8Array(17).fill(0x20);
  for (const headers of [{}, { "content-length": "1" }]) {
    await expectCategory(fetchCatalog({
      fetchImpl: async () => responseFromBytes(overLimit, { headers: { "content-type": "application/json", ...headers } }),
      clock: () => 0,
      maxBytes: 16
    }), "oversized");
  }
});

test("aborts and singly cancels every rejected post-fetch response", async () => {
  const validBytes = encoder.encode(JSON.stringify(fixtureCatalog()));
  const earlyRejections = [
    [trackedResponseFromBytes(validBytes, { status: 302 }), "redirect", {}],
    [trackedResponseFromBytes(validBytes, { url: "https://models.dev/other.json" }), "redirect", {}],
    [trackedResponseFromBytes(validBytes, { status: 500 }), "http", {}],
    [trackedResponseFromBytes(validBytes, { headers: { "content-type": "text/html" } }), "content-type", {}],
    [trackedResponseFromBytes(validBytes, { headers: { "content-type": "application/json", "content-length": "invalid" } }), "malformed", {}],
    [trackedResponseFromBytes(validBytes, { headers: { "content-type": "application/json", "content-length": "17" } }), "oversized", { maxBytes: 16 }]
  ];
  for (const [tracked, category, options] of earlyRejections) {
    await expectCleanedPostFetchRejection(tracked, category, options);
  }

  await expectCleanedPostFetchRejection(
    trackedResponseFromBytes(new Uint8Array(17), { close: false }),
    "oversized",
    { maxBytes: 16 }
  );
  await expectCleanedPostFetchRejection(
    trackedResponseFromBytes(encoder.encode("{not-json}")),
    "malformed"
  );
  await expectCleanedPostFetchRejection(
    trackedResponseFromBytes(encoder.encode("[".repeat(MAX_JSON_NESTING_DEPTH + 1) + "]".repeat(MAX_JSON_NESTING_DEPTH + 1))),
    "schema"
  );
  await expectCleanedPostFetchRejection(
    trackedResponseFromBytes(encoder.encode(JSON.stringify({ unsafe: provider("Unsafe") }))),
    "schema"
  );
  await expectCleanedPostFetchRejection(trackedFailingReaderResponse(), "network");
});

test("streams UTF-8, never calls response.text, and parses only bounded valid JSON", async () => {
  const jsonBytes = encoder.encode(JSON.stringify(fixtureCatalog()));
  const split = Math.floor(jsonBytes.length / 2);
  const streamed = await fetchCatalog({
    fetchImpl: async () => responseFromBytes(jsonBytes, { chunks: [jsonBytes.slice(0, split), jsonBytes.slice(split)] }),
    clock: () => 0
  });
  assert.equal(streamed.stats.bytes, jsonBytes.byteLength);

  await expectCategory(fetchCatalog({
    fetchImpl: async () => responseFromBytes(encoder.encode("{not-json}")),
    clock: () => 0
  }), "malformed");
  await expectCategory(fetchCatalog({
    fetchImpl: async () => responseFromBytes(Uint8Array.from([0x7b, 0xc3, 0x28, 0x7d])),
    clock: () => 0
  }), "malformed");
  await expectCategory(fetchCatalog({
    fetchImpl: async () => responseFromBytes(new Uint8Array(), { body: {} }),
    clock: () => 0
  }), "malformed");
});

test("rejects deeply nested and wide container floods before JSON.parse", async () => {
  const payloads = [
    "[".repeat(250_000) + "]".repeat(250_000),
    `[${"{},".repeat(MAX_JSON_CONTAINERS)}{}]`,
    `[${"0,".repeat(MAX_JSON_STRUCTURAL_TOKENS)}0]`,
    `{${"\"\":0,".repeat(MAX_JSON_OBJECT_MEMBERS)}"":0}`
  ];

  for (const text of payloads) {
    let parserCalls = 0;
    await expectCategory(fetchCatalog({
      fetchImpl: async () => responseFromText(text),
      clock: () => 0,
      parseJson(value) {
        parserCalls += 1;
        return JSON.parse(value);
      }
    }), "schema");
    assert.equal(parserCalls, 0);
  }
});

test("preflight ignores JSON structure-like text inside strings", async () => {
  const text = String.raw`{"openrouter":{"id":"openrouter","name":"Literal [{\"}] \\ slash \u007b\u005b","models":{"sonnet":{"id":"anthropic/claude-sonnet-4.6","name":"Claude ] } { [ escaped: \" unicode: \u007d","family":"claude","attachment":true,"reasoning":true,"tool_call":true,"modalities":{"input":["text","image"],"output":["text"]},"cost":{"input":3,"output":15},"limit":{"context":200000,"output":64000}}}}}`;
  let parserCalls = 0;
  const result = await fetchCatalog({
    fetchImpl: async () => responseFromText(text),
    clock: () => 0,
    parseJson(value) {
      parserCalls += 1;
      return JSON.parse(value);
    }
  });

  assert.equal(parserCalls, 1);
  assert.equal(result.stats.providers, 1);
  assert.equal(result.stats.models, 1);
  assert.equal(result.providers[0].label, "Literal [{\"}] \\ slash {[");
  assert.equal(result.providers[0].models[0].label, "Claude ] } { [ escaped: \" unicode: }");
});

test("rejects incomplete lexical structures before JSON.parse", async () => {
  const malformed = [
    "{\"safe\":{\"id\":\"safe\",\"models\":{}}",
    "{\"safe\":\"trailing\\",
    "{\"safe\":\"incomplete \\u12\"}",
    "{\"safe\":[}"
  ];

  for (const text of malformed) {
    let parserCalls = 0;
    await expectCategory(fetchCatalog({
      fetchImpl: async () => responseFromText(text),
      clock: () => 0,
      parseJson(value) {
        parserCalls += 1;
        return JSON.parse(value);
      }
    }), "malformed");
    assert.equal(parserCalls, 0);
  }
});

test("extracts stable minimal records and discards executable or sensitive metadata", () => {
  let executableReads = 0;
  const openrouter = provider("openrouter", {
    z: model("z/model", "Zulu", { pricing: { input: 99 }, api: "model-api-secret" }),
    a: model("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6", { doc: "model-doc-secret" })
  }, "OpenRouter", {
    api: "https://api-secret.invalid",
    doc: "https://doc-secret.invalid",
    npm: "secret-package",
    env: ["SECRET_TOKEN"],
    pricing: { input: 42 }
  });
  Object.defineProperty(openrouter, "executable", { enumerable: true, get() { executableReads += 1; throw new Error("must not execute"); } });
  const records = extractCatalog({ zebra: provider("zebra"), openrouter, alpha: provider("alpha") });

  assert.equal(executableReads, 0);
  assert.deepEqual(records.map(({ id }) => id), ["alpha", "openrouter", "zebra"]);
  assert.deepEqual(records[1], {
    id: "openrouter",
    label: "OpenRouter",
    models: [
      { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6" },
      { id: "z/model", label: "Zulu" }
    ]
  });
  assert.deepEqual(Object.keys(records[1]), ["id", "label", "models"]);
  assert.deepEqual(Object.keys(records[1].models[0]), ["id", "label"]);
  assert.doesNotMatch(JSON.stringify(records), /api|doc|npm|env|pricing|SECRET|secret-package/i);
  assert.ok(Object.isFrozen(records));
  assert.ok(Object.isFrozen(records[1]));
  assert.ok(Object.isFrozen(records[1].models));
  assert.ok(Object.isFrozen(records[1].models[0]));
  assert.throws(() => { records[1].models[0].id = "changed"; }, TypeError);
});

test("sanitizes and caps labels while rejecting hostile IDs", () => {
  const longLabel = "界".repeat(MAX_LABEL_CODE_POINTS + 10);
  const longUnlabelledId = "m".repeat(MAX_LABEL_CODE_POINTS + 10);
  const records = extractCatalog({
    safe: provider("safe", {
      safe: model("safe/model", `  Alpha\x1b]52;c;payload\x07\u202e\tBeta  `),
      fallback: model("fallback/model", "\x1b]0;title\x07"),
      long: { id: longUnlabelledId }
    }, longLabel)
  });
  assert.equal(Array.from(records[0].label).length, MAX_LABEL_CODE_POINTS);
  assert.equal(records[0].models[0].id, "fallback/model", "model sort remains ID-based after label sanitation");
  assert.equal(records[0].models[0].label, "fallback/model");
  assert.equal(Array.from(records[0].models[1].label).length, MAX_LABEL_CODE_POINTS, "fallback labels are capped independently of longer model IDs");
  assert.equal(records[0].models[2].label, "Alpha Beta");
  assert.doesNotMatch(JSON.stringify(records), /\x1b|\u202e|payload|title/u);

  const boundaryProviderId = `p${"a".repeat(MAX_PROVIDER_ID_CODE_POINTS - 1)}`;
  const boundaryModelId = "m".repeat(MAX_MODEL_ID_CODE_POINTS);
  const boundary = extractCatalog({ boundary: provider(boundaryProviderId, { boundary: model(boundaryModelId) }) });
  assert.equal(Array.from(boundary[0].id).length, MAX_PROVIDER_ID_CODE_POINTS);
  assert.equal(Array.from(boundary[0].models[0].id).length, MAX_MODEL_ID_CODE_POINTS);
  assert.equal(Array.from(boundary[0].models[0].label).length, MAX_LABEL_CODE_POINTS);

  const providerIds = [
    "",
    "Uppercase",
    "has/slash",
    " edge",
    "edge ",
    "a".repeat(MAX_PROVIDER_ID_CODE_POINTS + 1),
    "safe\x1b[31m",
    "safe\u202e",
    "safe\ud800"
  ];
  for (const id of providerIds) assert.throws(() => extractCatalog({ fixture: provider(id) }), (error) => error.category === "schema" && error.provider_calls === 0);

  const modelIds = [
    "",
    " edge",
    "edge ",
    "m".repeat(MAX_MODEL_ID_CODE_POINTS + 1),
    "safe\x1b]52;c;x\x07",
    "safe\u2066",
    "safe\udfff"
  ];
  for (const id of modelIds) assert.throws(() => extractCatalog({ safe: provider("safe", { fixture: model(id) }) }), (error) => error.category === "schema");
});

test("rejects default-ignorables in IDs and removes them from otherwise valid Unicode labels", () => {
  const ignorables = [
    "\u00ad",
    "\u061c",
    "\u200b",
    "\u200c",
    "\u200d",
    "\u200e",
    "\u200f",
    "\u2060",
    "\u2066",
    "\u2069",
    "\ufeff",
    "\ufe0f",
    "\u{e0100}"
  ];

  for (const character of ignorables) {
    assert.throws(
      () => extractCatalog({ safe: provider("safe", { fixture: model(`safe${character}id`) }) }),
      (error) => error.category === "schema"
    );
  }

  const models = Object.fromEntries(ignorables.map((character, index) => [
    `m${index}`,
    model(`m${index}`, `Alpha${character}Beta`)
  ]));
  models.unicode = model("unicode", "Café 東京 🚀");
  models.emojiJoiner = model("emoji-joiner", "🧑‍💻 ✈️");
  const records = extractCatalog({ safe: provider("safe", models, "Säfe 🚀") });
  const byId = new Map(records[0].models.map((entry) => [entry.id, entry.label]));
  for (let index = 0; index < ignorables.length; index += 1) assert.equal(byId.get(`m${index}`), "AlphaBeta");
  assert.equal(records[0].label, "Säfe 🚀");
  assert.equal(byId.get("unicode"), "Café 東京 🚀");
  assert.equal(byId.get("emoji-joiner"), "🧑💻 ✈");
});

test("rejects non-plain shapes, invalid fields, accessors, and duplicate identities", () => {
  const invalidRoots = [null, [], "catalog", Object.create({ inherited: true })];
  for (const root of invalidRoots) assert.throws(() => extractCatalog(root), (error) => error.category === "schema");
  assert.throws(() => extractCatalog({ bad: [] }), (error) => error.category === "schema");
  assert.throws(() => extractCatalog({ bad: { id: "bad", name: "Bad", models: [] } }), (error) => error.category === "schema");
  assert.throws(() => extractCatalog({ bad: provider("bad", { entry: [] }) }), (error) => error.category === "schema");
  assert.throws(() => extractCatalog({ bad: provider("bad", {}, 42) }), (error) => error.category === "schema");
  assert.throws(() => extractCatalog({ bad: provider("bad", { entry: model("entry", 42) }) }), (error) => error.category === "schema");

  let getterRuns = 0;
  const accessorProvider = { name: "Accessor", models: {} };
  Object.defineProperty(accessorProvider, "id", { enumerable: true, get() { getterRuns += 1; return "accessor"; } });
  assert.throws(() => extractCatalog({ accessor: accessorProvider }), (error) => error.category === "schema");
  assert.equal(getterRuns, 0);

  assert.throws(() => extractCatalog({ one: provider("same"), two: provider("same") }), (error) => error.category === "schema");
  assert.throws(() => extractCatalog({ safe: provider("safe", { one: model("same"), two: model("same") }) }), (error) => error.category === "schema");
});

test("enforces provider, per-provider model, and total-model count limits", () => {
  const maximumProviders = Object.fromEntries(Array.from({ length: MAX_PROVIDERS }, (_, index) => [`p${index}`, provider(`p${index}`)]));
  assert.equal(extractCatalog(maximumProviders).length, MAX_PROVIDERS);
  const tooManyProviders = Object.fromEntries(Array.from({ length: MAX_PROVIDERS + 1 }, (_, index) => [`p${index}`, provider(`p${index}`)]));
  assert.throws(() => extractCatalog(tooManyProviders), (error) => error.category === "schema");

  const maximumModels = Object.fromEntries(Array.from({ length: MAX_MODELS_PER_PROVIDER }, (_, index) => [`m${index}`, model(`m${index}`)]));
  assert.equal(extractCatalog({ safe: provider("safe", maximumModels) })[0].models.length, MAX_MODELS_PER_PROVIDER);
  const tooManyModels = Object.fromEntries(Array.from({ length: MAX_MODELS_PER_PROVIDER + 1 }, (_, index) => [`m${index}`, model(`m${index}`)]));
  assert.throws(() => extractCatalog({ safe: provider("safe", tooManyModels) }), (error) => error.category === "schema");

  const exactTotal = {};
  for (let providerIndex = 0; providerIndex < 3; providerIndex += 1) {
    const models = Object.fromEntries(Array.from({ length: 4_000 }, (_, modelIndex) => [`m${modelIndex}`, model(`m${modelIndex}`)]));
    exactTotal[`p${providerIndex}`] = provider(`p${providerIndex}`, models);
  }
  assert.equal(extractCatalog(exactTotal).reduce((total, item) => total + item.models.length, 0), MAX_TOTAL_MODELS);

  const totalOverflow = {};
  for (let providerIndex = 0; providerIndex < 3; providerIndex += 1) {
    const models = Object.fromEntries(Array.from({ length: 4_001 }, (_, modelIndex) => [`m${modelIndex}`, model(`m${modelIndex}`)]));
    totalOverflow[`p${providerIndex}`] = provider(`p${providerIndex}`, models);
  }
  assert.equal(Object.values(totalOverflow).every(({ models }) => Object.keys(models).length <= MAX_MODELS_PER_PROVIDER), true);
  assert.ok(Object.values(totalOverflow).reduce((total, item) => total + Object.keys(item.models).length, 0) > MAX_TOTAL_MODELS);
  assert.throws(() => extractCatalog(totalOverflow), (error) => error.category === "schema");
});

test("rejects near-limit entry floods without bulk descriptor allocation or proxy access", () => {
  const manyTinyProviders = nearLimitTinyProviderMap();
  const originalBulkDescriptors = Object.getOwnPropertyDescriptors;
  const originalDescriptor = Object.getOwnPropertyDescriptor;
  let descriptorReads = 0;
  Object.getOwnPropertyDescriptors = () => { throw new Error("bulk descriptor enumeration is forbidden"); };
  Object.getOwnPropertyDescriptor = (value, key) => {
    if (value === manyTinyProviders) descriptorReads += 1;
    return originalDescriptor.call(Object, value, key);
  };
  try {
    assert.throws(() => extractCatalog(manyTinyProviders), (error) => error.category === "schema");
    assert.equal(descriptorReads, MAX_PROVIDERS + 1);
    descriptorReads = 0;
    assert.throws(
      () => extractCatalog({ safe: provider("safe", manyTinyProviders) }),
      (error) => error.category === "schema"
    );
    assert.equal(descriptorReads, MAX_MODELS_PER_PROVIDER + 1);
  } finally {
    Object.getOwnPropertyDescriptors = originalBulkDescriptors;
    Object.getOwnPropertyDescriptor = originalDescriptor;
  }

  const trapCounts = { getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 };
  const proxiedFlood = new Proxy(manyTinyProviders, {
    getOwnPropertyDescriptor(target, key) {
      trapCounts.getOwnPropertyDescriptor += 1;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    getPrototypeOf(target) {
      trapCounts.getPrototypeOf += 1;
      return Reflect.getPrototypeOf(target);
    },
    ownKeys(target) {
      trapCounts.ownKeys += 1;
      return Reflect.ownKeys(target);
    }
  });
  assert.throws(() => extractCatalog(proxiedFlood), (error) => error.category === "schema");
  assert.deepEqual(trapCounts, { getOwnPropertyDescriptor: 0, getPrototypeOf: 0, ownKeys: 0 });
});

test("schema failures from fetch remain safe one-request adapter errors", async () => {
  await expectCategory(fetchCatalog({
    fetchImpl: async () => responseFromJson({ unsafe: provider("Unsafe") }),
    clock: () => 0
  }), "schema");
});
