export type MemoryType = "preference" | "fact" | "decision" | "workflow" | "project" | "correction" | "source";

export interface MemoryRecord {
  id: string;
  userId: string;
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

export interface CreateMemoryInput {
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

export interface MemoryPage {
  items: MemoryRecord[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

export interface MemoryListOptions {
  limit?: number;
  offset?: number;
  type?: MemoryType;
  projectId?: string;
  tag?: string;
}

export interface MemorySearchOptions extends MemoryListOptions {
  q: string;
}

export interface MemoryStore {
  create(memory: MemoryRecord): Promise<MemoryRecord>;
  list(userId: string, options: Required<Pick<MemoryListOptions, "limit" | "offset">> & MemoryListOptions): Promise<MemoryPage>;
  search(userId: string, options: Required<Pick<MemorySearchOptions, "limit" | "offset" | "q">> & MemorySearchOptions): Promise<MemoryPage>;
  get(userId: string, id: string): Promise<MemoryRecord | undefined>;
  update(userId: string, id: string, patch: UpdateMemoryInput & { updatedAt: string }): Promise<MemoryRecord | undefined>;
  delete(userId: string, id: string): Promise<boolean>;
}

export interface MemoryService {
  createMemory(userId: string, input: CreateMemoryInput): Promise<MemoryRecord>;
  listMemories(userId: string, options?: MemoryListOptions): Promise<MemoryPage>;
  searchMemories(userId: string, options: MemorySearchOptions): Promise<MemoryPage>;
  getMemory(userId: string, id: string): Promise<MemoryRecord>;
  updateMemory(userId: string, id: string, patch: UpdateMemoryInput): Promise<MemoryRecord>;
  deleteMemory(userId: string, id: string): Promise<{ deleted: true }>;
}

export interface PgStyleClient {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number }>;
}

export interface MemoryClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

export interface MemoryClient {
  createMemory(input: CreateMemoryInput): Promise<MemoryRecord>;
  listMemories(options?: MemoryListOptions): Promise<MemoryPage>;
  searchMemories(options: MemorySearchOptions): Promise<MemoryPage>;
  getMemory(id: string): Promise<MemoryRecord>;
  updateMemory(id: string, patch: UpdateMemoryInput): Promise<MemoryRecord>;
  deleteMemory(id: string): Promise<{ deleted: true }>;
}

export const ALLOWED_MEMORY_TYPES: readonly MemoryType[];
export class MemoryValidationError extends Error {
  code: "validation_error";
  status: 400;
  details: Array<{ field: string; message: string }>;
}
export class MemoryNotFoundError extends Error {
  code: "not_found";
  status: 404;
}
export class MemoryApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
}

export function createInMemoryStore(initialMemories?: MemoryRecord[]): MemoryStore;
export function createPostgresMemoryStore(client: PgStyleClient): MemoryStore;
export function createMemoryService(options: { store: MemoryStore; now?: () => Date; idGenerator?: () => string }): MemoryService;
export function createMemoryHttpHandler(options?: { service?: MemoryService; apiKeys?: Record<string, string> | Map<string, string> | ((apiKey: string) => string | undefined | Promise<string | undefined>) }): (req: any, res: any) => Promise<void>;
export function createMemoryHttpServer(options?: Parameters<typeof createMemoryHttpHandler>[0]): any;
export function createMemoryClient(options: MemoryClientOptions): MemoryClient;
