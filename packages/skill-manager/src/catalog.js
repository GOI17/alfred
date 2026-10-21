import { randomUUID } from "node:crypto";
import { fail, validName } from "./model.js";

const origin = "https://skills.sh";
const controls = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/;
const safeText = (value, maximum) => typeof value === "string" && value.trim() && value.length <= maximum && !controls.test(value);

function resultRow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("E_CATALOG_RESPONSE", "The catalog returned a malformed result.");
  const { source } = value;
  if (!safeText(source, 200) || !/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(source)) {
    fail("E_UNSUPPORTED_SOURCE", "The catalog returned an unsupported source; only GitHub owner/repository sources can be resolved.");
  }
  const skillId = value.skillId ?? (typeof value.id === "string" && value.id.startsWith(`${source}/`) ? value.id.slice(source.length + 1) : undefined);
  try { validName(skillId); } catch { fail("E_CATALOG_RESPONSE", "The catalog returned an invalid skill slug."); }
  const id = `${source}/${skillId}`;
  if (value.id !== undefined && value.id !== id) fail("E_CATALOG_RESPONSE", "Catalog result identity does not match its source and skill slug.");
  if (!safeText(value.name, 200)) fail("E_CATALOG_RESPONSE", "The catalog returned an invalid skill display name.");
  if (value.installs !== undefined && value.installs !== null && (!Number.isSafeInteger(value.installs) || value.installs < 0)) fail("E_CATALOG_RESPONSE", "The catalog returned an invalid installation count.");
  return { id, source, skillId, name: value.name, installs: value.installs ?? null,
    repository: `https://github.com/${source}`, url: `${origin}/${id}` };
}

export async function searchSkills(query, { limit = 10, fetch: fetcher = globalThis.fetch, now = () => new Date() } = {}) {
  let networkAccess = false;
  const timestamp = () => new Date(now()).toISOString();
  const trace = (status, count = 0, reason = null) => ({ trace_id: `skill-catalog-${randomUUID()}`, timestamp: timestamp(),
    event: "skill_catalog_search", actor: "alfred-skills", data: { operation: "search", catalog: "skills.sh", query,
      status, count, reason, network_access: networkAccess, provider_calls: 0, provider_request_decision: "local-only" } });
  try {
    if (!safeText(query, 200) || query.trim().length < 2) fail("E_ARGUMENT", "Search query must contain 2–200 characters without control characters.");
    query = query.trim().replace(/ +/g, " ");
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) fail("E_ARGUMENT", "Search --limit must be an integer from 1 to 20.");
    const url = new URL("/api/search", origin);
    url.searchParams.set("q", query); url.searchParams.set("limit", String(limit));
    let response;
    networkAccess = true;
    try {
      response = await fetcher(url.href, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(15_000),
        headers: { Accept: "application/json", "User-Agent": "alfred-skill-manager" } });
    } catch { fail("E_CATALOG_UNAVAILABLE", "The skills.sh catalog is unavailable. Retry or browse https://skills.sh; no suggestions were fabricated."); }
    if (!response.ok) fail(response.status === 429 ? "E_CATALOG_RATE_LIMIT" : "E_CATALOG_UNAVAILABLE", `The skills.sh catalog returned HTTP ${response.status}; retry or browse https://skills.sh.`);
    const reader = response.body?.getReader();
    if (!reader) fail("E_CATALOG_RESPONSE", "The catalog returned an empty response body.");
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) { await reader.cancel(); fail("E_LIMIT", "Catalog response exceeds 1 MiB."); }
        chunks.push(Buffer.from(value));
      }
    } finally { reader.releaseLock(); }
    let parsed;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { fail("E_CATALOG_RESPONSE", "The catalog returned invalid JSON."); }
    if (!parsed || !Array.isArray(parsed.skills) || parsed.skills.length > limit) fail("E_CATALOG_RESPONSE", "The catalog returned an invalid or oversized result list.");
    const results = parsed.skills.map(resultRow);
    if (new Set(results.map((row) => row.id)).size !== results.length) fail("E_CATALOG_RESPONSE", "The catalog returned duplicate skill identities.");
    return { status: "ok", catalog: "skills.sh", query, retrievedAt: timestamp(), results, count: results.length, provider_calls: 0, trace: trace("ok", results.length) };
  } catch (error) {
    error.trace = trace("failed", 0, error.code ?? "E_CATALOG_UNAVAILABLE");
    throw error;
  }
}
