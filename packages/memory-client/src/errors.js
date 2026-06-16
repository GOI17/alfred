export class MemoryClientError extends Error {
  constructor(message, { code, status, details, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "MemoryClientError";
    this.code = code ?? "http_error";
    if (status !== undefined) this.status = status;
    if (details !== undefined) this.details = details;
  }
}
