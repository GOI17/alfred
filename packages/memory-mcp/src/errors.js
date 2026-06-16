const DEFAULT_UNEXPECTED_ERROR = {
  code: "unexpected_error",
  message: "Unexpected error."
};

const SENSITIVE_KEY_PATTERN = /api[-_ ]?key|authorization|token|secret|password/i;
const STACK_LINE_PATTERN = /^\s*at\s+\S+/m;

export function isMemoryClientError(error) {
  return Boolean(error && typeof error === "object" && error.name === "MemoryClientError");
}

export function errorResult(error) {
  if (isMemoryClientError(error)) {
    return resultFromSafeError(safeMemoryClientError(error));
  }

  return resultFromSafeError(DEFAULT_UNEXPECTED_ERROR);
}

export function validationErrorResult(message, details = undefined) {
  return resultFromSafeError({
    code: "validation_error",
    message,
    ...(details === undefined ? {} : { details: sanitizeValue(details) })
  });
}

function resultFromSafeError(error) {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error }) }],
    structuredContent: { error }
  };
}

function safeMemoryClientError(error) {
  return {
    code: safeString(error.code, "memory_client_error"),
    message: safeOperationalMessage(error),
    ...(typeof error.status === "number" ? { status: error.status } : {}),
    ...(error.details === undefined ? {} : { details: sanitizeValue(error.details) })
  };
}

function safeOperationalMessage(error) {
  if (error.code === "configuration_error") return "Memory MCP configuration failed.";
  if (error.code === "validation_error") return "Memory request validation failed.";
  if (error.code === "network_error") return "Memory API request failed.";
  return "Memory API request failed.";
}

function sanitizeValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, seen));
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeValue(entry, seen);
    }
    return output;
  }

  return undefined;
}

function sanitizeString(value) {
  if (STACK_LINE_PATTERN.test(value)) return "[REDACTED]";
  return value
    .replace(/[^\s,}]*api[-_ ]?key[^\s,}]*/gi, "[REDACTED]")
    .replace(/(authorization|token|secret|password)(\s*[=:]\s*)?[^,\s}]*/gi, "$1$2[REDACTED]");
}

function safeString(value, fallback) {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  return sanitizeString(value.trim());
}
