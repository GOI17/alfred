import type { MemoryClient } from "@alfred-labs/memory-client";

export interface McpContentText {
  type: "text";
  text: string;
}

export interface McpToolResult<TStructuredContent = unknown> {
  content: McpContentText[];
  structuredContent?: TStructuredContent;
  isError?: true;
}

export interface ServerLike {
  registerTool(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
      securitySchemes?: Array<{ type: "oauth2"; scopes: string[] }>;
      annotations?: {
        readOnlyHint?: boolean;
        openWorldHint?: boolean;
        destructiveHint?: boolean;
      };
      _meta?: Record<string, unknown>;
    },
    handler: (input: unknown) => Promise<McpToolResult> | McpToolResult
  ): unknown;
  connect?(transport: unknown): Promise<void>;
}

export interface CreateMemoryMcpServerOptions {
  memoryClient: MemoryClient;
  server?: ServerLike;
  schema?: MemoryMcpSchemaAdapter;
  McpServer?: new (serverInfo: { name: string; version: string }, options?: { instructions?: string }) => ServerLike;
  serverInfo?: { name: string; version: string };
  serverOptions?: { instructions?: string };
}

export interface RegisterMemoryToolsOptions {
  memoryClient: MemoryClient;
  schema?: MemoryMcpSchemaAdapter;
}

export interface MemoryMcpSchemaAdapter {
  searchInput: unknown;
  createInput: unknown;
  captureInput: unknown;
  captureOutput: unknown;
  updateInput: unknown;
  deleteInput: unknown;
  listInput: unknown;
  memoryOutput: unknown;
  deleteOutput: unknown;
  listOutput: unknown;
}

export const MEMORY_MCP_SERVER_INFO: Readonly<{ name: "alfred-memory-mcp"; version: "0.7.1" }>;
export const MEMORY_MCP_SERVER_OPTIONS: Readonly<{ instructions: string }>;

export function createMemoryMcpServer(options: CreateMemoryMcpServerOptions): Promise<ServerLike>;
export function registerMemoryTools(server: ServerLike, options: RegisterMemoryToolsOptions): ServerLike;
export function createPlainSchemaAdapter(): MemoryMcpSchemaAdapter;
export function createZodSchemaAdapter(zod: unknown): MemoryMcpSchemaAdapter;
export function memoryToolNames(): string[];
export function isMemoryClientError(error: unknown): boolean;
export function errorResult(error: unknown): McpToolResult<{ error: unknown }>;
export function validationErrorResult(message: string, details?: unknown): McpToolResult<{ error: unknown }>;
