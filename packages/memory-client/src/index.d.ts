export type MemoryType = "preference" | "fact" | "decision" | "workflow" | "project" | "correction" | "source";
export type MemoryNamespace = string;

export interface MemoryRecord {
  id: string;
  userId: string;
  namespace: MemoryNamespace;
  type: MemoryType;
  content: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
  projectId?: string | null;
  metadata?: Record<string, unknown> | null;
  confidence?: number | null;
  expiresAt?: string | null;
}

export interface MemoryPage {
  items: MemoryRecord[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface CreateMemoryInput {
  namespace?: MemoryNamespace;
  type: MemoryType;
  content: string;
  tags?: string[];
  source: string;
  projectId?: string;
  metadata?: Record<string, unknown>;
  confidence?: number;
  expiresAt?: string;
}

export interface UpdateMemoryInput {
  type?: MemoryType;
  content?: string;
  tags?: string[];
  source?: string;
  projectId?: string | null;
  metadata?: Record<string, unknown> | null;
  confidence?: number | null;
  expiresAt?: string | null;
}

export interface MemoryListOptions {
  limit?: number;
  offset?: number;
  type?: MemoryType;
  namespace?: MemoryNamespace;
  projectId?: string;
  tag?: string;
}

export interface MemorySearchOptions extends MemoryListOptions {
  q: string;
}

export interface MemoryClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export interface MemoryClient {
  createMemory(input: CreateMemoryInput): Promise<MemoryRecord>;
  getMemory(id: string): Promise<MemoryRecord>;
  listMemories(options?: MemoryListOptions): Promise<MemoryPage>;
  searchMemories(options: MemorySearchOptions): Promise<MemoryPage>;
  updateMemory(id: string, patch: UpdateMemoryInput): Promise<MemoryRecord>;
  deleteMemory(id: string): Promise<{ deleted: true }>;
}

export class MemoryClientError extends Error {
  name: "MemoryClientError";
  code: "configuration_error" | "validation_error" | "network_error" | "http_error" | string;
  status?: number;
  details?: unknown;
  constructor(
    message: string,
    options?: { code?: string; status?: number; details?: unknown; cause?: unknown }
  );
}

export function createMemoryClient(options: MemoryClientOptions): MemoryClient;
