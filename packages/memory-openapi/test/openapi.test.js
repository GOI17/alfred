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
  "GET /memories/search",
  "POST /memories",
  "GET /memories",
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

  it("uses HTTP bearer auth", () => {
    const security = spec.components?.securitySchemes?.bearerAuth;
    assert.ok(security, "bearerAuth security scheme must exist");
    assert.equal(security.type, "http");
    assert.equal(security.scheme, "bearer");
  });

  it("declares global bearer security", () => {
    assert.deepEqual(spec.security, [{ bearerAuth: [] }]);
  });

  it("exposes only the required operationIds", () => {
    const actual = collectOperationIds(spec);
    const expected = new Set([
      "healthCheck",
      "listAgents",
      "listSkills",
      "checkPolicy",
      "searchMemoriesV2",
      "searchMemories",
      "listMemories",
      "createMemory",
      "updateMemory",
      "deleteMemory"
    ]);
    assert.deepEqual(actual, expected);
  });

  it("exposes exactly the approved route surface", () => {
    assert.deepEqual(collectRoutes(spec), expectedRoutes);
  });

  it("marks mutators as consequential", () => {
    const mutators = ["createMemory", "updateMemory", "deleteMemory"];
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
      "/memories/search",
      "/memories",
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
      index = assignValue(item, key, rawValue, lines, index, indent + 2);

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
  const colonIndex = text.indexOf(":");
  return colonIndex > 0;
}

function splitPair(text, lineNumber) {
  const colonIndex = text.indexOf(":");
  if (colonIndex <= 0) {
    throw new Error(`Expected mapping pair on line ${lineNumber}: ${text}`);
  }

  const key = stripQuotes(text.slice(0, colonIndex).trim());
  const value = text.slice(colonIndex + 1).trim();
  return [key, value];
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
