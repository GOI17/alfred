const OAUTH_PATH = "/oauth/authorize";
const OAUTH_FIELDS = Object.freeze([
  "response_type",
  "client_id",
  "redirect_uri",
  "state",
  "scope"
]);
const OAUTH_FIELD_SET = new Set(OAUTH_FIELDS);
const PARSE_ORIGIN = "https://alfred.invalid";
const MAX_CONTINUATION_LENGTH = 4096;

export const RECOVERY_FALLBACK_URL = "/console/";

export class RecoveryContinuationError extends Error {
  constructor() {
    super("Recovery continuation is not allowed.");
    this.name = "RecoveryContinuationError";
    this.code = "invalid_recovery_continuation";
  }
}

function invalidContinuation() {
  throw new RecoveryContinuationError();
}

function canonicalOAuthPath(request) {
  const query = new URLSearchParams();
  for (const field of OAUTH_FIELDS) query.set(field, request[field]);
  return `${OAUTH_PATH}?${query.toString()}`;
}

export function buildOAuthRecoveryHref(request) {
  return `/console/?${new URLSearchParams({
    continue_to: canonicalOAuthPath(request)
  }).toString()}`;
}

export function createRecoveryContinuationPolicy({ oauthService = null } = {}) {
  function normalize(value) {
    if (value === undefined || value === null || value === "") {
      return { kind: "console", url: RECOVERY_FALLBACK_URL, stored: null };
    }
    if (
      typeof value !== "string" ||
      value.length > MAX_CONTINUATION_LENGTH ||
      !value.startsWith(`${OAUTH_PATH}?`) ||
      !value.startsWith("/") ||
      value.startsWith("//") ||
      /[\\\u0000-\u001f\u007f]/u.test(value)
    ) {
      return invalidContinuation();
    }

    let parsed;
    try {
      parsed = new URL(value, PARSE_ORIGIN);
    } catch {
      return invalidContinuation();
    }
    if (parsed.origin !== PARSE_ORIGIN || parsed.pathname !== OAUTH_PATH || parsed.hash) {
      return invalidContinuation();
    }

    const counts = new Map();
    for (const [name] of parsed.searchParams) {
      if (!OAUTH_FIELD_SET.has(name)) return invalidContinuation();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    if (OAUTH_FIELDS.some((name) => counts.get(name) !== 1)) return invalidContinuation();
    if (typeof oauthService?.validateAuthorizationRequest !== "function") return invalidContinuation();

    let request;
    try {
      request = oauthService.validateAuthorizationRequest(Object.fromEntries(parsed.searchParams));
    } catch {
      return invalidContinuation();
    }
    const url = canonicalOAuthPath(request);
    return { kind: "oauth", url, stored: url };
  }

  function resolveStored(value) {
    try {
      return normalize(value);
    } catch {
      return { kind: "console", url: RECOVERY_FALLBACK_URL, stored: null };
    }
  }

  return Object.freeze({ normalize, resolveStored });
}
