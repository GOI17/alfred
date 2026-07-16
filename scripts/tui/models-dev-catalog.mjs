import { types as utilTypes } from "node:util";

export const CATALOG_URL = "https://models.dev/api.json";
export const DEFAULT_TIMEOUT_MS = 5_000;
export const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
export const MAX_PROVIDERS = 512;
export const MAX_MODELS_PER_PROVIDER = 4_096;
export const MAX_TOTAL_MODELS = 12_000;
export const MAX_PROVIDER_ID_CODE_POINTS = 128;
export const MAX_MODEL_ID_CODE_POINTS = 512;
export const MAX_LABEL_CODE_POINTS = 256;
// models.dev's catalog schema is shallow; 32 leaves conservative headroom while
// preventing deeply nested JSON from amplifying allocations inside JSON.parse.
export const MAX_JSON_NESTING_DEPTH = 32;
// These lexical ceilings leave headroom over the verified ~3.18 MiB catalog
// (166 providers/5,666 models) but reject wide allocation floods pre-parse.
export const MAX_JSON_CONTAINERS = 100_000;
export const MAX_JSON_STRUCTURAL_TOKENS = 750_000;
export const MAX_JSON_OBJECT_MEMBERS = 250_000;

export const CATALOG_LIMITS = Object.freeze({
  providers: MAX_PROVIDERS,
  models_per_provider: MAX_MODELS_PER_PROVIDER,
  total_models: MAX_TOTAL_MODELS,
  provider_id_code_points: MAX_PROVIDER_ID_CODE_POINTS,
  model_id_code_points: MAX_MODEL_ID_CODE_POINTS,
  label_code_points: MAX_LABEL_CODE_POINTS,
  json_nesting_depth: MAX_JSON_NESTING_DEPTH,
  json_containers: MAX_JSON_CONTAINERS,
  json_structural_tokens: MAX_JSON_STRUCTURAL_TOKENS,
  json_object_members: MAX_JSON_OBJECT_MEMBERS
});

export const CATALOG_ERROR_CATEGORIES = Object.freeze([
  "timeout",
  "aborted",
  "network",
  "http",
  "redirect",
  "content-type",
  "oversized",
  "malformed",
  "schema"
]);

const ERROR_MESSAGES = Object.freeze({
  timeout: "The models.dev catalog request timed out.",
  aborted: "The models.dev catalog request was cancelled.",
  network: "The models.dev catalog could not be downloaded.",
  http: "models.dev returned an unexpected HTTP status.",
  redirect: "The models.dev catalog request was redirected.",
  "content-type": "models.dev did not return JSON.",
  oversized: "The models.dev catalog exceeded the size limit.",
  malformed: "The models.dev catalog was not valid JSON.",
  schema: "The models.dev catalog did not match the expected schema."
});

const CATEGORY_SET = new Set(CATALOG_ERROR_CATEGORIES);
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const BIDI_CONTROL_PATTERN = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const ID_CONTROL_PATTERN = /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}\u2028\u2029]/u;
const LABEL_IGNORABLE_PATTERN = /[\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

export class CatalogError extends Error {
  constructor(category, { metadataRequests = 0 } = {}) {
    const safeCategory = CATEGORY_SET.has(category) ? category : "schema";
    super(ERROR_MESSAGES[safeCategory]);
    this.name = "CatalogError";
    this.category = safeCategory;
    this.metadata_requests = metadataRequests === 1 ? 1 : 0;
    this.provider_calls = 0;
  }
}

export function isCatalogError(error) {
  return error instanceof CatalogError && CATEGORY_SET.has(error.category);
}

export function catalogErrorCategory(error) {
  return isCatalogError(error) ? error.category : "network";
}

export const getCatalogErrorCategory = catalogErrorCategory;

function fail(category = "schema", metadataRequests = 0) {
  throw new CatalogError(category, { metadataRequests });
}

function isHexCode(code) {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
}

function isSimpleEscapeCode(code) {
  return (
    code === 0x22 ||
    code === 0x2f ||
    code === 0x5c ||
    code === 0x62 ||
    code === 0x66 ||
    code === 0x6e ||
    code === 0x72 ||
    code === 0x74
  );
}

export function preflightCatalogJson(text, metadataRequests = 0) {
  if (typeof text !== "string") fail("malformed", metadataRequests);
  const closingTokens = [];
  let inString = false;
  let containers = 0;
  let structuralTokens = 0;
  let objectMembers = 0;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (inString) {
      if (code === 0x22) {
        inString = false;
        continue;
      }
      if (code < 0x20) fail("malformed", metadataRequests);
      if (code !== 0x5c) continue;

      index += 1;
      if (index >= text.length) fail("malformed", metadataRequests);
      const escape = text.charCodeAt(index);
      if (escape === 0x75) {
        if (index + 4 >= text.length) fail("malformed", metadataRequests);
        for (let offset = 1; offset <= 4; offset += 1) {
          if (!isHexCode(text.charCodeAt(index + offset))) fail("malformed", metadataRequests);
        }
        index += 4;
      } else if (!isSimpleEscapeCode(escape)) {
        fail("malformed", metadataRequests);
      }
      continue;
    }

    if (code === 0x22) {
      inString = true;
      continue;
    }

    if (code === 0x7b || code === 0x5b) {
      structuralTokens += 1;
      containers += 1;
      if (
        closingTokens.length >= MAX_JSON_NESTING_DEPTH ||
        containers > MAX_JSON_CONTAINERS ||
        structuralTokens > MAX_JSON_STRUCTURAL_TOKENS
      ) fail("schema", metadataRequests);
      closingTokens.push(code === 0x7b ? 0x7d : 0x5d);
      continue;
    }

    if (code === 0x7d || code === 0x5d) {
      structuralTokens += 1;
      if (structuralTokens > MAX_JSON_STRUCTURAL_TOKENS) fail("schema", metadataRequests);
      if (closingTokens.pop() !== code) fail("malformed", metadataRequests);
      continue;
    }

    if (code === 0x3a || code === 0x2c) {
      structuralTokens += 1;
      if (structuralTokens > MAX_JSON_STRUCTURAL_TOKENS) fail("schema", metadataRequests);
      if (code === 0x3a && closingTokens[closingTokens.length - 1] === 0x7d) {
        objectMembers += 1;
        if (objectMembers > MAX_JSON_OBJECT_MEMBERS) fail("schema", metadataRequests);
      }
    }
  }

  if (inString || closingTokens.length !== 0) fail("malformed", metadataRequests);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) || utilTypes.isProxy(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedDataEntries(value, maximum) {
  if (!isPlainObject(value)) fail("schema");
  const entries = [];
  for (const key in value) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (!descriptor.enumerable) continue;
    if (entries.length >= maximum) fail("schema");
    if (!Object.hasOwn(descriptor, "value")) fail("schema");
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function dataField(value, field) {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, "value")) fail("schema");
  return descriptor.value;
}

function hasValidUnicode(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function exceedsCodePointLimit(value, maximum) {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) >= 0xd800 && value.charCodeAt(index) <= 0xdbff) index += 1;
    count += 1;
    if (count > maximum) return true;
  }
  return false;
}

function safeId(value, maximum, provider = false) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    !hasValidUnicode(value) ||
    value.trim() !== value ||
    exceedsCodePointLimit(value, maximum) ||
    ID_CONTROL_PATTERN.test(value) ||
    BIDI_CONTROL_PATTERN.test(value) ||
    (provider && !PROVIDER_ID_PATTERN.test(value))
  ) fail("schema");
  return value;
}

function consumeCsi(value, index, introducerLength) {
  let cursor = index + introducerLength;
  while (cursor < value.length && value.charCodeAt(cursor) >= 0x30 && value.charCodeAt(cursor) <= 0x3f) cursor += 1;
  while (cursor < value.length && value.charCodeAt(cursor) >= 0x20 && value.charCodeAt(cursor) <= 0x2f) cursor += 1;
  return cursor < value.length && value.charCodeAt(cursor) >= 0x40 && value.charCodeAt(cursor) <= 0x7e ? cursor + 1 : value.length;
}

function consumeControlString(value, index, introducerLength, bellTerminates) {
  for (let cursor = index + introducerLength; cursor < value.length; cursor += 1) {
    const code = value.charCodeAt(cursor);
    if (bellTerminates && code === 0x07) return cursor + 1;
    if (code === 0x9c) return cursor + 1;
    if (code === 0x1b && value[cursor + 1] === "\\") return cursor + 2;
  }
  return value.length;
}

function terminalSequenceEnd(value, index) {
  const code = value.charCodeAt(index);
  if (code === 0x9b) return consumeCsi(value, index, 1);
  if (code === 0x9d) return consumeControlString(value, index, 1, true);
  if ([0x90, 0x98, 0x9e, 0x9f].includes(code)) return consumeControlString(value, index, 1, false);
  if (code !== 0x1b) return null;
  const next = value[index + 1];
  if (next === "[") return consumeCsi(value, index, 2);
  if (next === "]") return consumeControlString(value, index, 2, true);
  if (["P", "X", "^", "_"].includes(next)) return consumeControlString(value, index, 2, false);
  if (next === "\\") return index + 2;
  let cursor = index + 1;
  while (cursor < value.length && value.charCodeAt(cursor) >= 0x20 && value.charCodeAt(cursor) <= 0x2f) cursor += 1;
  if (cursor < value.length && value.charCodeAt(cursor) >= 0x30 && value.charCodeAt(cursor) <= 0x7e) cursor += 1;
  return Math.max(index + 1, cursor);
}

function capLabel(value) {
  let output = "";
  let count = 0;
  for (const character of value) {
    if (count >= MAX_LABEL_CODE_POINTS) break;
    output += character;
    count += 1;
  }
  return output;
}

function sanitizedLabel(value, fallback) {
  if (value === undefined) return capLabel(fallback);
  if (typeof value !== "string" || !hasValidUnicode(value)) fail("schema");
  let output = "";
  let outputCodePoints = 0;
  const append = (character) => {
    if (outputCodePoints >= MAX_LABEL_CODE_POINTS) return;
    output += character;
    outputCodePoints += 1;
  };
  const addSpace = () => { if (output && !output.endsWith(" ")) append(" "); };
  for (let index = 0; index < value.length;) {
    if (outputCodePoints >= MAX_LABEL_CODE_POINTS) break;
    const sequenceEnd = terminalSequenceEnd(value, index);
    if (sequenceEnd !== null) {
      index = sequenceEnd;
      continue;
    }
    const codePoint = value.codePointAt(index);
    const character = String.fromCodePoint(codePoint);
    index += character.length;
    if (BIDI_CONTROL_PATTERN.test(character) || LABEL_IGNORABLE_PATTERN.test(character)) continue;
    if (codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0b || codePoint === 0x0c || codePoint === 0x0d || codePoint === 0x85 || codePoint === 0x2028 || codePoint === 0x2029) {
      addSpace();
      continue;
    }
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) continue;
    append(character);
  }
  const clean = output.trim();
  if (!clean) return capLabel(fallback);
  return clean;
}

function compareIds(left, right) {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function freezeRecords(providers) {
  for (const provider of providers) {
    for (const model of provider.models) Object.freeze(model);
    Object.freeze(provider.models);
    Object.freeze(provider);
  }
  return Object.freeze(providers);
}

export function extractCatalog(json) {
  const providerEntries = boundedDataEntries(json, MAX_PROVIDERS);

  const providers = [];
  const providerIds = new Set();
  let totalModels = 0;

  for (const [, rawProvider] of providerEntries) {
    if (!isPlainObject(rawProvider)) fail("schema");
    const id = safeId(dataField(rawProvider, "id"), MAX_PROVIDER_ID_CODE_POINTS, true);
    if (providerIds.has(id)) fail("schema");
    providerIds.add(id);

    const modelEntries = boundedDataEntries(dataField(rawProvider, "models"), MAX_MODELS_PER_PROVIDER);
    totalModels += modelEntries.length;
    if (totalModels > MAX_TOTAL_MODELS) fail("schema");

    const models = [];
    const modelIds = new Set();
    for (const [, rawModel] of modelEntries) {
      if (!isPlainObject(rawModel)) fail("schema");
      const modelId = safeId(dataField(rawModel, "id"), MAX_MODEL_ID_CODE_POINTS);
      if (modelIds.has(modelId)) fail("schema");
      modelIds.add(modelId);
      models.push({ id: modelId, label: sanitizedLabel(dataField(rawModel, "name"), modelId) });
    }
    models.sort(compareIds);
    providers.push({ id, label: sanitizedLabel(dataField(rawProvider, "name"), id), models });
  }

  providers.sort(compareIds);
  return freezeRecords(providers);
}

function headerValue(headers, name) {
  if (headers && typeof headers.get === "function") return headers.get(name);
  if (!headers || typeof headers !== "object") return null;
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? null : headers[key];
}

function validateResponse(response, maxBytes) {
  if (!response || typeof response !== "object") fail("network", 1);
  if (response.redirected === true || (Number.isInteger(response.status) && response.status >= 300 && response.status <= 399)) fail("redirect", 1);
  if (response.url !== CATALOG_URL) fail("redirect", 1);
  if (response.status !== 200) fail("http", 1);

  const contentType = headerValue(response.headers, "content-type");
  if (typeof contentType !== "string" || contentType.split(";", 1)[0].trim().toLowerCase() !== "application/json") fail("content-type", 1);

  const contentLength = headerValue(response.headers, "content-length");
  if (contentLength !== null && contentLength !== undefined) {
    const value = String(contentLength).trim();
    if (!/^\d+$/u.test(value)) fail("malformed", 1);
    if (BigInt(value) > BigInt(maxBytes)) fail("oversized", 1);
  }
}

function raceAbort(promise, abortPromise) {
  return Promise.race([promise, abortPromise]);
}

function createResponseCleanup(response) {
  return { response, body: undefined, bodyResolved: false, reader: null, cancelled: false };
}

function cleanupBody(state) {
  if (state.bodyResolved) return state.body;
  state.bodyResolved = true;
  try {
    state.body = state.response?.body;
  } catch {
    state.body = undefined;
  }
  return state.body;
}

function cancelResponseBody(state) {
  if (!state || state.cancelled) return;
  state.cancelled = true;
  const target = state.reader ?? cleanupBody(state);
  if (!target || typeof target.cancel !== "function") return;
  try {
    Promise.resolve(target.cancel()).catch(() => {});
  } catch {}
}

async function readBoundedJson(responseState, maxBytes, abortPromise, parseJson) {
  const body = cleanupBody(responseState);
  if (!body || typeof body.getReader !== "function") fail("malformed", 1);
  let reader;
  try {
    reader = body.getReader();
  } catch {
    fail("malformed", 1);
  }
  responseState.reader = reader;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const result = await raceAbort(Promise.resolve().then(() => reader.read()), abortPromise);
      if (!result || typeof result !== "object") fail("network", 1);
      if (result.done) {
        break;
      }
      if (!(result.value instanceof Uint8Array)) fail("malformed", 1);
      bytes += result.value.byteLength;
      if (bytes > maxBytes) fail("oversized", 1);
      try {
        text += decoder.decode(result.value, { stream: true });
      } catch {
        fail("malformed", 1);
      }
    }
    try {
      text += decoder.decode();
    } catch {
      fail("malformed", 1);
    }
  } catch (error) {
    cancelResponseBody(responseState);
    throw error;
  } finally {
    try { reader.releaseLock(); } catch {}
    responseState.reader = null;
  }

  preflightCatalogJson(text, 1);
  let json;
  try {
    json = parseJson(text);
  } catch {
    fail("malformed", 1);
  }
  return { json, bytes };
}

function validateFetchOptions(fetchImpl, clock, timeoutMs, maxBytes, signal, parseJson) {
  if (typeof fetchImpl !== "function" || typeof clock !== "function" || typeof parseJson !== "function") fail("schema");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) fail("schema");
  if (signal !== undefined && (!signal || typeof signal.aborted !== "boolean" || typeof signal.addEventListener !== "function" || typeof signal.removeEventListener !== "function")) fail("schema");
}

function duration(start, end) {
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0;
}

export async function fetchCatalog({
  fetchImpl = globalThis.fetch,
  clock = () => performance.now(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBytes = DEFAULT_MAX_BYTES,
  signal,
  parseJson = JSON.parse
} = {}) {
  validateFetchOptions(fetchImpl, clock, timeoutMs, maxBytes, signal, parseJson);
  if (signal?.aborted) throw new CatalogError("aborted");
  const startedAt = Number(clock());
  const controller = new AbortController();
  let abortCategory = "aborted";
  let requestStarted = false;
  let responseState;
  let parentAbort;
  let rejectAbort;
  const abortPromise = new Promise((resolve, reject) => { rejectAbort = reject; });
  const requestAbort = () => rejectAbort(new CatalogError(abortCategory, { metadataRequests: requestStarted ? 1 : 0 }));
  controller.signal.addEventListener("abort", requestAbort, { once: true });

  if (signal) {
    parentAbort = () => {
      abortCategory = "aborted";
      controller.abort();
    };
    signal.addEventListener("abort", parentAbort, { once: true });
  }

  const timer = setTimeout(() => {
    abortCategory = "timeout";
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  try {
    if (controller.signal.aborted) throw new CatalogError(abortCategory);
    requestStarted = true;
    const response = await raceAbort(Promise.resolve().then(() => fetchImpl(CATALOG_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "manual",
      credentials: "omit",
      referrer: "",
      referrerPolicy: "no-referrer",
      signal: controller.signal
    })), abortPromise);
    responseState = createResponseCleanup(response);
    validateResponse(response, maxBytes);
    const { json, bytes } = await readBoundedJson(responseState, maxBytes, abortPromise, parseJson);
    const providers = extractCatalog(json);
    const models = providers.reduce((total, provider) => total + provider.models.length, 0);
    return Object.freeze({
      providers,
      stats: Object.freeze({ bytes, providers: providers.length, models, duration_ms: duration(startedAt, Number(clock())) }),
      metadata_requests: 1,
      provider_calls: 0
    });
  } catch (error) {
    const requestWasAborted = controller.signal.aborted;
    if (responseState) {
      if (!controller.signal.aborted) controller.abort();
      cancelResponseBody(responseState);
    }
    if (isCatalogError(error)) {
      if (requestStarted && error.metadata_requests !== 1) error.metadata_requests = 1;
      throw error;
    }
    throw new CatalogError(requestWasAborted ? abortCategory : "network", { metadataRequests: requestStarted ? 1 : 0 });
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener("abort", requestAbort);
    if (signal && parentAbort) signal.removeEventListener("abort", parentAbort);
  }
}
