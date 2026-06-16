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
    },
    handler: (input: unknown) => Promise<McpToolResult> | McpToolResult
  ): unknown;
  connect?(transport: unknown): Promise<void>;
}

export interface CreateMemoryMcpServerOptions {
  memoryClient: MemoryClient;
  server?: ServerLike;
  schema?: MemoryMcpSchemaAdapter;
  McpServer?: new (serverInfo: { name: string; version: string }) => ServerLike;
  serverInfo?: { name: string; version: string };
}

export interface RegisterMemoryToolsOptions {
  memoryClient: MemoryClient;
  schema?: MemoryMcpSchemaAdapter;
}

export interface MemoryMcpSchemaAdapter {
  searchInput: unknown;
  createInput: unknown;
  updateInput: unknown;
  deleteInput: unknown;
  listInput: unknown;
}

export const MEMORY_MCP_SERVER_INFO: Readonly<{ name: "alfred-memory-mcp"; version: "0.0.0" }>;

export function createMemoryMcpServer(options: CreateMemoryMcpServerOptions): Promise<ServerLike>;
export function registerMemoryTools(server: ServerLike, options: RegisterMemoryToolsOptions): ServerLike;
export function createPlainSchemaAdapter(): MemoryMcpSchemaAdapter;
export function createZodSchemaAdapter(zod: unknown): MemoryMcpSchemaAdapter;
export function memoryToolNames(): string[];
export function isMemoryClientError(error: unknown): boolean;
export function errorResult(error: unknown): McpToolResult<{ error: unknown }>;
export function validationErrorResult(message: string, details?: unknown): McpToolResult<{ error: unknown }>;
