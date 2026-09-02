import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export const OAUTH_SCOPES = Object.freeze(["memory:read", "memory:write"]);

export class OAuthConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "OAuthConfigError";
    this.code = "oauth_config_error";
  }
}

export class OAuthError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "OAuthError";
    this.code = code;
    this.status = status;
  }
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new OAuthConfigError(`${name} must be a positive integer.`);
  }
  return parsed;
}

function secureUrl(value, name, { allowLocalhost = false, stripTrailingSlash = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new OAuthConfigError(`${name} must be a valid URL.`); }
  const local = allowLocalhost && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new OAuthConfigError(`${name} must use HTTPS.`);
  }
  if (url.username || url.password || url.hash) {
    throw new OAuthConfigError(`${name} must not include credentials or a fragment.`);
  }
  const normalized = url.toString();
  return stripTrailingSlash ? normalized.replace(/\/$/, "") : normalized;
}

export function loadOAuthConfig(env = process.env) {
  const names = [
    "ALFRED_OAUTH_CLIENT_ID",
    "ALFRED_OAUTH_CLIENT_SECRET",
    "ALFRED_OAUTH_REDIRECT_URIS"
  ];
  const supplied = names.filter((name) => typeof env[name] === "string" && env[name].trim() !== "");
  if (supplied.length === 0) return Object.freeze({ enabled: false });
  const missing = names.filter((name) => !supplied.includes(name));
  if (missing.length > 0) {
    throw new OAuthConfigError(`OAuth configuration is incomplete; missing ${missing.join(", ")}.`);
  }

  const clientId = env.ALFRED_OAUTH_CLIENT_ID.trim();
  const clientSecret = env.ALFRED_OAUTH_CLIENT_SECRET;
  if (clientId.length > 128) throw new OAuthConfigError("ALFRED_OAUTH_CLIENT_ID is too long.");
  if (clientSecret.length < 32) throw new OAuthConfigError("ALFRED_OAUTH_CLIENT_SECRET must contain at least 32 characters.");

  const publicUrl = secureUrl(env.ALFRED_PUBLIC_URL ?? "", "ALFRED_PUBLIC_URL", {
    allowLocalhost: true,
    stripTrailingSlash: true
  });
  const redirectUris = env.ALFRED_OAUTH_REDIRECT_URIS.split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => secureUrl(value, "ALFRED_OAUTH_REDIRECT_URIS", { allowLocalhost: true }));
  if (redirectUris.length === 0) throw new OAuthConfigError("ALFRED_OAUTH_REDIRECT_URIS must not be empty.");

  return Object.freeze({
    enabled: true,
    clientId,
    clientSecret,
    publicUrl,
    redirectUris: Object.freeze([...new Set(redirectUris)]),
    authorizationCodeTtlSeconds: positiveInteger(env.ALFRED_OAUTH_CODE_TTL_SECONDS, 300, "ALFRED_OAUTH_CODE_TTL_SECONDS"),
    accessTokenTtlSeconds: positiveInteger(env.ALFRED_OAUTH_ACCESS_TTL_SECONDS, 3600, "ALFRED_OAUTH_ACCESS_TTL_SECONDS"),
    refreshTokenTtlSeconds: positiveInteger(env.ALFRED_OAUTH_REFRESH_TTL_SECONDS, 2_592_000, "ALFRED_OAUTH_REFRESH_TTL_SECONDS")
  });
}

export function hashOAuthSecret(value) {
  return createHash("sha256").update(value).digest("hex");
}

function opaque(prefix) {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

function safeEqual(actual, expected) {
  const a = createHash("sha256").update(actual ?? "").digest();
  const b = createHash("sha256").update(expected ?? "").digest();
  return timingSafeEqual(a, b);
}

function normalizeScope(value) {
  const requested = typeof value === "string" && value.trim()
    ? value.trim().split(/\s+/)
    : [...OAUTH_SCOPES];
  const unique = [...new Set(requested)];
  if (unique.length === 0 || unique.some((scope) => !OAUTH_SCOPES.includes(scope))) {
    throw new OAuthError("invalid_scope", "Requested OAuth scope is not supported.");
  }
  return unique.sort().join(" ");
}

function futureIso(nowMs, seconds) {
  return new Date(nowMs + seconds * 1000).toISOString();
}

export function createOAuthService({ config, registry, userService, now = () => Date.now(), trace = null } = {}) {
  if (!config?.enabled) throw new OAuthConfigError("OAuth is not enabled.");
  if (!registry?.oauth) throw new TypeError("createOAuthService requires registry.oauth.");
  if (typeof userService?.resolveApiKey !== "function") throw new TypeError("createOAuthService requires userService.");

  const emit = trace ?? ((event) => registry.oauth.recordTrace(event));

  function validateAuthorizationRequest(input) {
    if (input.response_type !== "code") throw new OAuthError("unsupported_response_type", "response_type must be code.");
    if (input.client_id !== config.clientId) throw new OAuthError("unauthorized_client", "Unknown OAuth client.", 401);
    if (!config.redirectUris.includes(input.redirect_uri)) throw new OAuthError("invalid_request", "redirect_uri is not allowed.");
    if (typeof input.state !== "string" || input.state.length === 0 || input.state.length > 2048) {
      throw new OAuthError("invalid_request", "state is required.");
    }
    return {
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: input.redirect_uri,
      state: input.state,
      scope: normalizeScope(input.scope)
    };
  }

  function authenticateClient({ client_id, client_secret }) {
    if (client_id !== config.clientId || !safeEqual(client_secret, config.clientSecret)) {
      throw new OAuthError("invalid_client", "Client authentication failed.", 401);
    }
  }

  async function authorize(input) {
    const request = validateAuthorizationRequest(input);
    if (typeof input.api_key !== "string" || input.api_key.length === 0) {
      throw new OAuthError("access_denied", "An Alfred API key is required.", 401);
    }
    const resolved = await userService.resolveApiKey(input.api_key);
    if (!resolved) throw new OAuthError("access_denied", "The Alfred API key is invalid or revoked.", 401);

    const code = opaque("alc");
    await registry.oauth.createAuthorizationCode({
      id: `oac_${randomUUID().replace(/-/g, "")}`,
      code_hash: hashOAuthSecret(code),
      tenant_id: resolved.tenant_id,
      client_id: request.client_id,
      redirect_uri: request.redirect_uri,
      scope: request.scope,
      expires_at: futureIso(now(), config.authorizationCodeTtlSeconds)
    });
    await emit({
      tenant_id: resolved.tenant_id,
      event: "oauth.authorization_code_issued",
      payload: { client_id: request.client_id, scope: request.scope, provider_calls: 0 }
    });
    const redirect = new URL(request.redirect_uri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", request.state);
    return { redirect_uri: redirect.toString() };
  }

  function tokenPair(tenantId, scope, familyId = `otf_${randomUUID().replace(/-/g, "")}`) {
    const issuedAt = now();
    const accessToken = opaque("alo");
    const refreshToken = opaque("alr");
    return {
      raw: { accessToken, refreshToken },
      access: {
        id: `oat_${randomUUID().replace(/-/g, "")}`,
        token_hash: hashOAuthSecret(accessToken), token_type: "access", tenant_id: tenantId,
        client_id: config.clientId, scope, family_id: familyId,
        expires_at: futureIso(issuedAt, config.accessTokenTtlSeconds)
      },
      refresh: {
        id: `ort_${randomUUID().replace(/-/g, "")}`,
        token_hash: hashOAuthSecret(refreshToken), token_type: "refresh", tenant_id: tenantId,
        client_id: config.clientId, scope, family_id: familyId,
        expires_at: futureIso(issuedAt, config.refreshTokenTtlSeconds)
      }
    };
  }

  function publicTokenResponse(pair) {
    return {
      access_token: pair.raw.accessToken,
      token_type: "bearer",
      expires_in: config.accessTokenTtlSeconds,
      refresh_token: pair.raw.refreshToken,
      scope: pair.access.scope
    };
  }

  async function exchangeAuthorizationCode(input) {
    authenticateClient(input);
    if (!input.code || !input.redirect_uri) throw new OAuthError("invalid_request", "code and redirect_uri are required.");
    const pair = tokenPair(null, "");
    const exchanged = await registry.oauth.exchangeAuthorizationCode({
      code_hash: hashOAuthSecret(input.code),
      client_id: config.clientId,
      redirect_uri: input.redirect_uri,
      now: new Date(now()).toISOString(),
      access: pair.access,
      refresh: pair.refresh
    });
    if (!exchanged) throw new OAuthError("invalid_grant", "Authorization code is invalid, expired, or already used.");
    pair.access.tenant_id = exchanged.tenant_id;
    pair.access.scope = exchanged.scope;
    pair.refresh.tenant_id = exchanged.tenant_id;
    pair.refresh.scope = exchanged.scope;
    await emit({
      tenant_id: exchanged.tenant_id,
      event: "oauth.authorization_code_exchanged",
      payload: { client_id: config.clientId, scope: exchanged.scope, provider_calls: 0 }
    });
    return publicTokenResponse(pair);
  }

  async function exchangeRefreshToken(input) {
    authenticateClient(input);
    if (!input.refresh_token) throw new OAuthError("invalid_request", "refresh_token is required.");
    const tokenHash = hashOAuthSecret(input.refresh_token);
    const current = await registry.oauth.findRefreshToken(tokenHash);
    if (!current || current.client_id !== config.clientId || new Date(current.expires_at).getTime() <= now()) {
      throw new OAuthError("invalid_grant", "Refresh token is invalid or expired.");
    }
    async function rejectReuse(token) {
      await registry.oauth.revokeTokenFamily(token.family_id, new Date(now()).toISOString());
      await emit({
        tenant_id: token.tenant_id,
        event: "oauth.refresh_token_reuse_detected",
        payload: { client_id: config.clientId, family_id: token.family_id, provider_calls: 0 }
      });
      throw new OAuthError("invalid_grant", "Refresh token reuse was detected; reconnect Alfred.");
    }
    if (current.revoked_at) {
      return rejectReuse(current);
    }
    const pair = tokenPair(current.tenant_id, current.scope, current.family_id);
    const rotated = await registry.oauth.rotateRefreshToken({
      token_hash: tokenHash,
      client_id: config.clientId,
      now: new Date(now()).toISOString(),
      access: pair.access,
      refresh: pair.refresh
    });
    if (!rotated) {
      // Another request may have rotated this token after our initial read.
      // Re-read so concurrent reuse also revokes the issued token family.
      const latest = await registry.oauth.findRefreshToken(tokenHash);
      if (latest?.revoked_at) return rejectReuse(latest);
      throw new OAuthError("invalid_grant", "Refresh token is invalid, expired, or already used.");
    }
    await emit({
      tenant_id: current.tenant_id,
      event: "oauth.refresh_token_rotated",
      payload: { client_id: config.clientId, family_id: current.family_id, provider_calls: 0 }
    });
    return publicTokenResponse(pair);
  }

  async function exchangeToken(input) {
    if (input.grant_type === "authorization_code") return exchangeAuthorizationCode(input);
    if (input.grant_type === "refresh_token") return exchangeRefreshToken(input);
    throw new OAuthError("unsupported_grant_type", "Supported grants are authorization_code and refresh_token.");
  }

  async function resolveAccessToken(token) {
    if (typeof token !== "string" || !token.startsWith("alo_")) return null;
    const row = await registry.oauth.resolveAccessToken(hashOAuthSecret(token), new Date(now()).toISOString());
    if (!row) return null;
    return { tenant_id: row.tenant_id, scopes: row.scope.split(/\s+/).filter(Boolean), token_id: row.id };
  }

  return { config, validateAuthorizationRequest, authorize, exchangeToken, resolveAccessToken };
}
