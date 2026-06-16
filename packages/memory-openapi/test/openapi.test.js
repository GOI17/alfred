import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const yamlPath = join(__dirname, "..", "openapi.yaml");

let parse;
try {
  ({ parse } = await import("yaml"));
} catch {
  // Fallback to the yaml copy available in this workspace when dependencies are
  // not installed yet.
  ({ parse } = await import("../../../.opencode/node_modules/yaml/dist/index.js"));
}

const yamlText = readFileSync(yamlPath, "utf8");
const spec = parse(yamlText);

describe("memory-openapi schema", () => {
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
      "searchMemories",
      "listMemories",
      "createMemory",
      "updateMemory",
      "deleteMemory"
    ]);
    assert.deepEqual(actual, expected);
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
    const paths = Object.keys(spec.paths ?? {});
    assert.ok(paths.includes("/health"));
    assert.ok(paths.includes("/memories/search"));
    assert.ok(paths.includes("/memories"));
    assert.ok(paths.includes("/memories/{id}"));
  });

  it("does not expose out-of-scope paths", () => {
    const allowed = new Set([
      "/health",
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
      "HealthResponse"
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
