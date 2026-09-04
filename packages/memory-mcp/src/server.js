import { errorResult, validationErrorResult } from "./errors.js";

export const MEMORY_MCP_SERVER_INFO = Object.freeze({
  name: "alfred-memory-mcp",
  version: "0.7.1"
});

export const MEMORY_MCP_SERVER_OPTIONS = Object.freeze({
  instructions: "Use search or list before creating duplicate memories. Treat memory IDs as opaque. Ask for confirmation before deleting a memory. Alfred Memory data is private to the connected tenant."
});

const MEMORY_TYPES = ["preference", "fact", "decision", "workflow", "project", "correction", "source"];
const TOOL_NAMES = ["memory_search", "memory_create", "memory_update", "memory_delete", "memory_list"];

export async function createMemoryMcpServer(options = {}) {
  const memoryClient = requiredMemoryClient(options.memoryClient);
  const schema = options.schema ?? createZodSchemaAdapter(await loadZod());
  const server = options.server ?? new (options.McpServer ?? (await loadMcpServer()))(
    options.serverInfo ?? MEMORY_MCP_SERVER_INFO,
    options.serverOptions ?? MEMORY_MCP_SERVER_OPTIONS
  );

  registerMemoryTools(server, { memoryClient, schema });
  return server;
}

export function registerMemoryTools(server, options = {}) {
  const memoryClient = requiredMemoryClient(options.memoryClient);
  const schema = options.schema ?? createPlainSchemaAdapter();
  const registerTool = requiredRegisterTool(server);

  registerTool("memory_search", {
    title: "Search memories",
    description: "Use this when the user wants to find relevant memories in their private Alfred workspace.",
    inputSchema: schema.searchInput,
    outputSchema: schema.listOutput,
    ...toolSecurity("memory:read", { readOnlyHint: true })
  }, async (input) => withSafeErrors(() => memoryClient.searchMemories(normalizeSearchInput(input))));

  registerTool("memory_create", {
    title: "Create memory",
    description: "Use this when the user explicitly wants Alfred to remember a durable fact, preference, decision, workflow, project detail, correction, or source.",
    inputSchema: schema.createInput,
    outputSchema: schema.memoryOutput,
    ...toolSecurity("memory:write")
  }, async (input) => withSafeErrors(() => memoryClient.createMemory(normalizeCreateInput(input))));

  registerTool("memory_update", {
    title: "Update memory",
    description: "Use this when the user wants to correct or revise an existing private Alfred memory identified by its exact ID.",
    inputSchema: schema.updateInput,
    outputSchema: schema.memoryOutput,
    ...toolSecurity("memory:write")
  }, async (input) => {
    if (input?.patch && Object.hasOwn(input.patch, "namespace")) {
      return validationErrorResult("memory_update patch must not include namespace.", [
        { field: "patch.namespace", message: "namespace cannot be updated." }
      ]);
    }

    return withSafeErrors(() => {
      const { id, patch } = normalizeUpdateInput(input);
      return memoryClient.updateMemory(id, patch);
    });
  });

  registerTool("memory_delete", {
    title: "Delete memory",
    description: "Use this only after confirmation when the user wants to permanently delete an existing private Alfred memory identified by its exact ID.",
    inputSchema: schema.deleteInput,
    outputSchema: schema.deleteOutput,
    ...toolSecurity("memory:write", { destructiveHint: true })
  }, async (input) => withSafeErrors(() => memoryClient.deleteMemory(normalizeIdInput(input, "memory_delete").id)));

  registerTool("memory_list", {
    title: "List memories",
    description: "Use this when the user wants to browse or filter memories in their private Alfred workspace.",
    inputSchema: schema.listInput,
    outputSchema: schema.listOutput,
    ...toolSecurity("memory:read", { readOnlyHint: true })
  }, async (input = {}) => withSafeErrors(() => memoryClient.listMemories(normalizeListInput(input))));

  return server;
}

export function createPlainSchemaAdapter() {
  return {
    searchInput: {
      q: { type: "string", required: true },
      ...listSchemaFields()
    },
    createInput: {
      namespace: { type: "string", optional: true },
      type: { enum: MEMORY_TYPES, required: true },
      content: { type: "string", required: true },
      tags: { type: "string[]", optional: true },
      source: { type: "string", required: true },
      projectId: { type: "string", optional: true },
      metadata: { type: "record", optional: true },
      confidence: { type: "number", optional: true },
      expiresAt: { type: "string", optional: true }
    },
    updateInput: {
      id: { type: "string", required: true },
      patch: {
        type: "object",
        fields: updatePatchSchemaFields(),
        required: true
      }
    },
    deleteInput: {
      id: { type: "string", required: true }
    },
    listInput: listSchemaFields(),
    memoryOutput: { type: "object", required: ["id"], additionalProperties: true },
    deleteOutput: {
      type: "object",
      fields: { deleted: { type: "boolean", required: true } },
      required: ["deleted"],
      additionalProperties: true
    },
    listOutput: {
      type: "object",
      fields: {
        items: { type: "object[]", required: true },
        pagination: { type: "object", required: true }
      },
      required: ["items", "pagination"],
      additionalProperties: true
    }
  };
}

export function createZodSchemaAdapter(zod) {
  const z = zod.z ?? zod.default ?? zod;
  const memoryType = z.enum(MEMORY_TYPES);
  const metadata = z.record(z.string(), z.unknown());

  const memoryOutput = z.object({ id: z.string() }).passthrough();
  const paginationOutput = z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number()
  }).passthrough();

  return {
    searchInput: z.object({
      q: z.string().min(1),
      ...zodListSchemaFields(z, memoryType)
    }),
    createInput: z.object({
      namespace: z.string().min(1).optional(),
      type: memoryType,
      content: z.string().min(1),
      tags: z.array(z.string().min(1)).optional(),
      source: z.string().min(1),
      projectId: z.string().min(1).optional(),
      metadata: metadata.optional(),
      confidence: z.number().optional(),
      expiresAt: z.string().min(1).optional()
    }),
    updateInput: z.object({
      id: z.string().min(1),
      patch: z.object({
        type: memoryType.optional(),
        content: z.string().min(1).optional(),
        tags: z.array(z.string().min(1)).optional(),
        source: z.string().min(1).optional(),
        projectId: z.string().min(1).nullable().optional(),
        metadata: metadata.nullable().optional(),
        confidence: z.number().nullable().optional(),
        expiresAt: z.string().min(1).nullable().optional()
      }).strict()
    }),
    deleteInput: z.object({
      id: z.string().min(1)
    }),
    listInput: z.object(zodListSchemaFields(z, memoryType)),
    memoryOutput,
    deleteOutput: z.object({ deleted: z.boolean() }).passthrough(),
    listOutput: z.object({
      items: z.array(z.record(z.string(), z.unknown())),
      pagination: paginationOutput
    }).passthrough()
  };
}

function toolSecurity(scope, annotationOverrides = {}) {
  const securitySchemes = [{ type: "oauth2", scopes: [scope] }];
  return {
    // `securitySchemes` is the current OpenAI tool-auth contract. Keep the
    // mirrored metadata entry for MCP SDK/client versions that expose vendor
    // extensions only through `_meta`.
    securitySchemes,
    _meta: { securitySchemes },
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      ...annotationOverrides
    }
  };
}

function zodListSchemaFields(z, memoryType) {
  return {
    limit: z.number().int().positive().optional(),
    offset: z.number().int().min(0).optional(),
    type: memoryType.optional(),
    namespace: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    tag: z.string().min(1).optional()
  };
}

function listSchemaFields() {
  return {
    limit: { type: "number", optional: true },
    offset: { type: "number", optional: true },
    type: { enum: MEMORY_TYPES, optional: true },
    namespace: { type: "string", optional: true },
    projectId: { type: "string", optional: true },
    tag: { type: "string", optional: true }
  };
}

function updatePatchSchemaFields() {
  return {
    type: { enum: MEMORY_TYPES, optional: true },
    content: { type: "string", optional: true },
    tags: { type: "string[]", optional: true },
    source: { type: "string", optional: true },
    projectId: { type: "string|null", optional: true },
    metadata: { type: "record|null", optional: true },
    confidence: { type: "number|null", optional: true },
    expiresAt: { type: "string|null", optional: true }
  };
}

async function withSafeErrors(operation) {
  try {
    return successResult(await operation());
  } catch (error) {
    return errorResult(error);
  }
}

function successResult(result) {
  const structuredContent = result ?? null;
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent
  };
}

function normalizeSearchInput(input) {
  assertPlainObject(input, "input", "memory_search input is required.");
  assertRequiredString(input.q, "q");
  return copyDefined(input, ["q", ...Object.keys(listSchemaFields())]);
}

function normalizeCreateInput(input) {
  assertPlainObject(input, "input", "memory_create input is required.");
  assertRequiredString(input.type, "type");
  assertRequiredString(input.content, "content");
  assertRequiredString(input.source, "source");
  return copyDefined(input, Object.keys(createPlainSchemaAdapter().createInput));
}

function normalizeUpdateInput(input) {
  const { id } = normalizeIdInput(input, "memory_update");
  assertPlainObject(input.patch, "patch", "memory_update patch is required.");
  return { id, patch: copyDefined(input.patch, Object.keys(updatePatchSchemaFields())) };
}

function normalizeIdInput(input, toolName) {
  assertPlainObject(input, "input", `${toolName} input is required.`);
  assertRequiredString(input.id, "id");
  return { id: input.id.trim() };
}

function normalizeListInput(input) {
  assertPlainObject(input, "input", "memory_list input must be an object.");
  return copyDefined(input, Object.keys(listSchemaFields()));
}

function copyDefined(input, fields) {
  const output = {};
  for (const field of fields) {
    if (input[field] !== undefined) output[field] = typeof input[field] === "string" ? input[field].trim() : input[field];
  }
  return output;
}

function assertPlainObject(value, field, message) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw memoryClientValidationError(message, [{ field, message }]);
  }
}

function assertRequiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw memoryClientValidationError(`${field} is required.`, [
      { field, message: `${field} must be a non-empty string.` }
    ]);
  }
}

function memoryClientValidationError(message, details) {
  const error = new Error(message);
  error.name = "MemoryClientError";
  error.code = "validation_error";
  error.details = details;
  return error;
}

function requiredMemoryClient(memoryClient) {
  if (!memoryClient || typeof memoryClient !== "object") {
    throw new TypeError("memoryClient is required.");
  }

  for (const method of ["searchMemories", "createMemory", "updateMemory", "deleteMemory", "listMemories"]) {
    if (typeof memoryClient[method] !== "function") {
      throw new TypeError(`memoryClient.${method} must be a function.`);
    }
  }

  return memoryClient;
}

function requiredRegisterTool(server) {
  if (!server || typeof server.registerTool !== "function") {
    throw new TypeError("server.registerTool must be a function.");
  }

  return server.registerTool.bind(server);
}

async function loadMcpServer() {
  const module = await import("@modelcontextprotocol/sdk/server/mcp.js");
  return module.McpServer;
}

async function loadZod() {
  return import("zod/v4");
}

export function memoryToolNames() {
  return [...TOOL_NAMES];
}
