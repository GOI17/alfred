import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const yamlPath = join(__dirname, "..", "openapi.yaml");
const packageJsonPath = join(__dirname, "..", "package.json");

const yamlText = readFileSync(yamlPath, "utf8");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const spec = parseYamlSubset(yamlText);

const expectedRoutes = new Set([
  "GET /health",
  "GET /agents/manifest",
  "GET /skills/manifest",
  "POST /policies/check",
  "POST /search",
  "POST /memories",
  "POST /memories/capture",
  "GET /memories",
  "GET /memories/{id}",
  "PATCH /memories/{id}",
  "DELETE /memories/{id}"
]);

describe("memory-openapi schema", () => {
  it("keeps the schema package dependency-free", () => {
    assert.equal(packageJson.dependencies, undefined);
    assert.equal(packageJson.devDependencies, undefined);
    assert.equal(packageJson.peerDependencies, undefined);
    assert.equal(packageJson.optionalDependencies, undefined);
  });

  it("parses as valid YAML", () => {
    assert.equal(typeof spec, "object");
    assert.notEqual(spec, null);
    assert.equal(spec.openapi, "3.1.0");
  });

  it("folds the schema's multiline descriptions and continues parsing sibling fields", () => {
    assert.equal(spec.info.description,
      "Exposes Alfred Memory as a ChatGPT Action. A Custom GPT can search, list, " +
      "create, update and delete durable memories for a user through this schema. " +
      "This is not a native ChatGPT Memory integration: Alfred Memory remains an " +
      "external service invoked by the Custom GPT at runtime.");
    assert.deepEqual(spec.info.contact, { name: "Alfred Labs" });
    assert.equal(spec.components.schemas.CreateMemoryInput.properties.namespace.description,
      "Defaults to personal or project:projectId when projectId is provided.");
    assert.equal(findOperation(spec, "searchMemories").description,
      "v0.4.1 search endpoint. mode: 'semantic' uses the local embedding model; " +
      "'keyword' uses the in-memory filter; 'hybrid' (default) blends both via " +
      "reciprocal rank fusion. Zero provider calls.");
  });

  it("uses OAuth 2.0 Authorization Code with Alfred endpoints", () => {
    const security = spec.components?.securitySchemes?.oauth2;
    assert.ok(security, "oauth2 security scheme must exist");
    assert.equal(security.type, "oauth2");
    assert.equal(security.flows.authorizationCode.authorizationUrl, "https://alfred-labs-memory.fly.dev/oauth/authorize");
    assert.equal(security.flows.authorizationCode.tokenUrl, "https://alfred-labs-memory.fly.dev/oauth/token");
    assert.deepEqual(Object.keys(security.flows.authorizationCode.scopes), ["memory:read", "memory:write"]);
  });

  it("declares global OAuth security", () => {
    assert.deepEqual(spec.security, [{ oauth2: ["memory:read", "memory:write"] }]);
  });

  it("exposes only the required operationIds", () => {
    const actual = collectOperationIds(spec);
    const expected = new Set([
      "healthCheck",
      "listAgents",
      "listSkills",
      "checkPolicy",
      "searchMemories",
      "listMemories",
      "getMemory",
      "createMemory",
      "captureMemory",
      "updateMemory",
      "deleteMemory"
    ]);
    assert.deepEqual(actual, expected);
  });

  it("exposes exactly the approved route surface", () => {
    assert.deepEqual(collectRoutes(spec), expectedRoutes);
  });

  it("marks mutators as consequential", () => {
    const mutators = ["createMemory", "captureMemory", "updateMemory", "deleteMemory"];
    for (const opId of mutators) {
      const op = findOperation(spec, opId);
      assert.equal(
        op["x-openai-isConsequential"],
        true,
        `${opId} must be x-openai-isConsequential: true`
      );
    }
  });

  it("does not mark read operations as consequential", () => {
    for (const opId of ["healthCheck", "searchMemories", "listMemories"]) {
      const op = findOperation(spec, opId);
      assert.notEqual(op["x-openai-isConsequential"], true);
    }
  });

  it("does not expose namespace in PATCH request body", () => {
    const patch =
      findOperation(spec, "updateMemory")?.requestBody?.content?.["application/json"]?.schema;
    assert.ok(patch, "PATCH request body schema must be defined");
    const ref = patch.$ref;
    assert.ok(ref, "PATCH request body should be a schema reference");
    const schema = resolveRef(spec, ref);
    assert.equal(
      schema.properties?.namespace,
      undefined,
      "PATCH input must not expose namespace"
    );
  });

  it("contains the required paths", () => {
    for (const route of expectedRoutes) {
      const [method, path] = route.split(" ");
      assert.ok(spec.paths?.[path]?.[method.toLowerCase()], `${route} must exist`);
    }
  });

  it("does not expose out-of-scope paths", () => {
    const allowed = new Set([
      "/health",
      "/agents/manifest",
      "/skills/manifest",
      "/policies/check",
      "/search",
      "/memories",
      "/memories/capture",
      "/memories/{id}"
    ]);
    const paths = Object.keys(spec.paths ?? {});
    for (const p of paths) {
      assert.ok(allowed.has(p), `path ${p} is out of scope`);
    }
  });

  it("defines expected schemas", () => {
    const schemas = Object.keys(spec.components?.schemas ?? {});
    for (const name of [
      "MemoryRecord",
      "CreateMemoryInput",
      "UpdateMemoryInput",
      "MemoryPage",
      "Error",
      "HealthResponse",
      "Agent",
      "AgentManifest",
      "Skill",
      "SkillManifest",
      "PolicyCheckInput",
      "PolicyCheckResult",
      "SearchInput",
      "SearchResult"
    ]) {
      assert.ok(schemas.includes(name), `schema ${name} must be defined`);
    }
  });

  it("uses read/write scopes per protected operation", () => {
    for (const opId of ["searchMemories", "listMemories", "getMemory"]) {
      assert.deepEqual(findOperation(spec, opId).security, [{ oauth2: ["memory:read"] }]);
    }
    for (const opId of ["createMemory", "captureMemory", "updateMemory", "deleteMemory"]) {
      assert.deepEqual(findOperation(spec, opId).security, [{ oauth2: ["memory:write"] }]);
    }
    for (const opId of ["healthCheck", "listAgents", "listSkills", "checkPolicy"]) {
      assert.deepEqual(findOperation(spec, opId).security, []);
    }
  });

  it("allows only allowed memory types", () => {
    const types = spec.components?.schemas?.MemoryType?.enum ?? [];
    assert.deepEqual(types, [
      "preference",
      "fact",
      "decision",
      "workflow",
      "project",
      "correction",
      "source"
    ]);
  });
});

function collectOperationIds(spec) {
  const ids = new Set();
  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const method of ["get", "post", "patch", "put", "delete"]) {
      const op = pathItem[method];
      if (op && typeof op.operationId === "string") {
        ids.add(op.operationId);
      }
    }
  }
  return ids;
}

function collectRoutes(spec) {
  const routes = new Set();
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      if (pathItem[method]) {
        routes.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return routes;
}

function findOperation(spec, operationId) {
  for (const pathItem of Object.values(spec.paths ?? {})) {
    for (const method of ["get", "post", "patch", "put", "delete"]) {
      const op = pathItem[method];
      if (op && op.operationId === operationId) {
        return op;
      }
    }
  }
  throw new Error(`operationId ${operationId} not found`);
}

function resolveRef(spec, ref) {
  if (!ref.startsWith("#/")) {
    throw new Error(`Cannot resolve external ref ${ref}`);
  }
  const parts = ref.slice(2).split("/");
  let value = spec;
  for (const part of parts) {
    value = value[part];
    if (value === undefined) {
      throw new Error(`Cannot resolve ref ${ref}`);
    }
  }
  return value;
}

function parseYamlSubset(text) {
  const lines = text
    .split(/\r?\n/)
    .map((raw, index) => ({
      index: index + 1,
      indent: raw.match(/^ */)[0].length,
      text: raw.trim()
    }))
    .filter((line) => line.text !== "" && !line.text.startsWith("#"));

  const { value, nextIndex } = parseBlock(lines, 0, 0);
  assert.equal(nextIndex, lines.length, "YAML parser must consume the full document");
  return value;
}

function parseBlock(lines, startIndex, indent) {
  if (startIndex >= lines.length) {
    return { value: {}, nextIndex: startIndex };
  }

  const first = lines[startIndex];
  if (first.indent < indent) {
    return { value: {}, nextIndex: startIndex };
  }

  if (first.indent !== indent) {
    throw new Error(
      `Unexpected indentation on line ${first.index}: expected ${indent}, got ${first.indent}`
    );
  }

  return first.text.startsWith("- ")
    ? parseSequence(lines, startIndex, indent)
    : parseMapping(lines, startIndex, indent);
}

function parseSequence(lines, startIndex, indent) {
  const array = [];
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }
    if (line.indent !== indent || !line.text.startsWith("- ")) {
      break;
    }

    const itemText = line.text.slice(2).trim();
    index += 1;

    let item;
    if (itemText === "") {
      const parsed = parseBlock(lines, index, indent + 2);
      item = parsed.value;
      index = parsed.nextIndex;
    } else if (isMappingPair(itemText)) {
      const [key, rawValue] = splitPair(itemText, line.index);
      item = {};
      const valueIndent = rawValue === "" && lines[index]?.indent > indent + 2
        ? lines[index].indent
        : indent + 2;
      index = assignValue(item, key, rawValue, lines, index, valueIndent);

      if (index < lines.length && lines[index].indent === indent + 2) {
        const parsed = parseMapping(lines, index, indent + 2);
        Object.assign(item, parsed.value);
        index = parsed.nextIndex;
      }
    } else {
      item = parseScalar(itemText);
    }

    array.push(item);
  }

  return { value: array, nextIndex: index };
}

function parseMapping(lines, startIndex, indent) {
  const object = {};
  let index = startIndex;

  while (index < lines.length) {
    const line = lines[index];
    if (line.indent < indent) {
      break;
    }
    if (line.indent !== indent || line.text.startsWith("- ")) {
      break;
    }

    const [key, rawValue] = splitPair(line.text, line.index);
    index += 1;
    index = assignValue(object, key, rawValue, lines, index, indent + 2);
  }

  return { value: object, nextIndex: index };
}

function assignValue(object, key, rawValue, lines, index, nestedIndent) {
  // The schema uses stripped, single-paragraph folded descriptions.
  // Their contents are text, even when a line contains a colon or quotes.
  if (rawValue === ">-") {
    const parts = [];
    while (index < lines.length && lines[index].indent >= nestedIndent) {
      parts.push(lines[index].text);
      index += 1;
    }
    object[key] = parts.join(" ");
    return index;
  }

  if (rawValue !== "") {
    object[key] = parseScalar(rawValue);
    return index;
  }

  if (index >= lines.length || lines[index].indent < nestedIndent) {
    object[key] = {};
    return index;
  }

  const parsed = parseBlock(lines, index, nestedIndent);
  object[key] = parsed.value;
  return parsed.nextIndex;
}

function isMappingPair(text) {
  return mappingColonIndex(text) > 0;
}

function splitPair(text, lineNumber) {
  const colonIndex = mappingColonIndex(text);
  if (colonIndex <= 0) {
    throw new Error(`Expected mapping pair on line ${lineNumber}: ${text}`);
  }

  const key = stripQuotes(text.slice(0, colonIndex).trim());
  const value = text.slice(colonIndex + 1).trim();
  return [key, value];
}

function mappingColonIndex(text) {
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if ((char === '"' || char === "'") && (!quote || quote === char)) {
      quote = quote ? null : char;
      continue;
    }
    if (!quote && char === ":" && (index === text.length - 1 || /\s/.test(text[index + 1]))) {
      return index;
    }
  }
  return -1;
}

function parseScalar(value) {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (value === "null") {
    return null;
  }
  if (value === "[]") {
    return [];
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return stripQuotes(value);
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}


it("capture contract requires bounded grounding evidence and no arbitrary metadata", () => {
  const operation = findOperation(spec, "captureMemory");
  assert.deepEqual(operation.security, [{ oauth2: ["memory:write"] }]);
  assert.ok(operation.responses["200"]);
  const input = spec.components.schemas.CaptureMemoryInput;
  assert.deepEqual(input.required, ["candidate", "context"]);
  assert.equal(input.additionalProperties, false);
  assert.equal(input.properties.candidate.properties.content.maxLength, 1000);
  assert.equal(input.properties.candidate.properties.metadata, undefined);
  assert.deepEqual(input.properties.context.required, ["evidence", "origin"]);
  assert.equal(input.properties.context.properties.evidence.maxLength, 2000);
  assert.deepEqual(spec.components.schemas.CaptureMemoryResult.properties.status.enum, ["created", "duplicate", "skipped"]);
});
