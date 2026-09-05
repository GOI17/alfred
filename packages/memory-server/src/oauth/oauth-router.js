import { OAuthError } from "./oauth-service.js";
import { buildOAuthRecoveryHref } from "../bootstrap/recovery-continuation.js";

const MAX_FORM_BYTES = 32 * 1024;
const CHATGPT_CALLBACK_ORIGIN = "https://chatgpt.com";
const OPENAI_PLATFORM_ORIGIN = "https://platform.openai.com";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function formActionOrigins(request) {
  const callbackOrigin = new URL(request.redirect_uri).origin;
  return callbackOrigin === CHATGPT_CALLBACK_ORIGIN
    ? [callbackOrigin, OPENAI_PLATFORM_ORIGIN]
    : [callbackOrigin];
}

function html(res, status, body, { allowedFormActionOrigins = [] } = {}) {
  const formAction = ["form-action", "'self'", ...allowedFormActionOrigins].join(" ");
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; ${formAction}; base-uri 'none'; frame-ancestors 'none'`,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  res.end(body);
}

function json(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    pragma: "no-cache",
    ...extraHeaders
  });
  res.end(JSON.stringify(body) + "\n");
}

async function readForm(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_FORM_BYTES) throw new OAuthError("invalid_request", "Form body is too large.", 413);
    chunks.push(chunk);
  }
  const contentType = String(req.headers["content-type"] ?? "").split(";", 1)[0].trim();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new OAuthError("invalid_request", "Content-Type must be application/x-www-form-urlencoded.", 415);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
}

function clientCredentials(req, form) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Basic ")) {
    try {
      const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
      const split = decoded.indexOf(":");
      if (split >= 0) {
        return {
          client_id: decoded.slice(0, split),
          client_secret: decoded.slice(split + 1)
        };
      }
    } catch {}
  }
  return { client_id: form.client_id, client_secret: form.client_secret };
}

function consentPage(request, errorMessage = "") {
  const hidden = ["response_type", "client_id", "redirect_uri", "state", "scope", "resource", "code_challenge", "code_challenge_method"]
    .filter((name) => request[name] !== null && request[name] !== undefined)
    .map((name) => `<input type="hidden" name="${name}" value="${escapeHtml(request[name])}">`).join("");
  const error = errorMessage ? `<p class="error" role="alert">${escapeHtml(errorMessage)}</p>` : "";
  const recoveryHref = escapeHtml(buildOAuthRecoveryHref(request));
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conectar Alfred Memory</title><style>body{font:16px system-ui;background:#f7f5ef;color:#1d1d1b;margin:0}.card{max-width:520px;margin:8vh auto;padding:32px;background:white;border:1px solid #ddd8ca;border-radius:18px;box-shadow:0 10px 40px #0001}h1{margin-top:0}label{display:block;font-weight:650;margin:24px 0 8px}input[type=password]{box-sizing:border-box;width:100%;padding:12px;border:1px solid #aaa;border-radius:8px;font:inherit}button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:8px;background:#1d1d1b;color:white;font:inherit;font-weight:700}.scope{padding:12px;background:#f4f1e8;border-radius:8px}.error{color:#a52020;font-weight:650}.note{color:#5b5b55;font-size:.92rem}.recovery{display:inline-block;margin-top:16px}</style></head><body><main class="card"><h1>Conectar Alfred Memory</h1><p>ChatGPT solicita acceso a tus memorias de Alfred.</p><p class="scope">Permisos: <strong>${escapeHtml(request.scope)}</strong></p>${error}<form method="post" action="/oauth/authorize">${hidden}<label for="api_key">Tu API key de Alfred</label><input id="api_key" name="api_key" type="password" required autocomplete="off" placeholder="alk_…"><p class="note">La key se valida únicamente en Alfred. ChatGPT recibirá tokens OAuth limitados y no verá esta key.</p><button type="submit">Autorizar conexión</button></form><a class="recovery" href="${recoveryHref}">¿Olvidaste tu API key? Recupérala y continúa con Alfred.</a></main></body></html>`;
}

export function createOAuthRouter({ oauthService = null } = {}) {
  return async function oauthHandler(req, res) {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!oauthService) {
      return json(res, 503, { error: "temporarily_unavailable", error_description: "OAuth is not configured on this server." });
    }
    try {
      if (url.pathname === "/.well-known/oauth-authorization-server" && req.method === "GET") {
        const origin = oauthService.config.publicUrl;
        return json(res, 200, {
          issuer: origin,
          authorization_endpoint: `${origin}/oauth/authorize`,
          token_endpoint: `${origin}/oauth/token`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
          code_challenge_methods_supported: ["S256"],
          scopes_supported: ["memory:read", "memory:write"]
        });
      }
      if (url.pathname === "/oauth/authorize" && req.method === "GET") {
        const request = oauthService.validateAuthorizationRequest(Object.fromEntries(url.searchParams));
        return html(res, 200, consentPage(request), {
          allowedFormActionOrigins: formActionOrigins(request)
        });
      }
      if (url.pathname === "/oauth/authorize" && req.method === "POST") {
        const form = await readForm(req);
        try {
          const result = await oauthService.authorize(form);
          res.writeHead(302, { location: result.redirect_uri, "cache-control": "no-store" });
          return res.end();
        } catch (err) {
          if (err instanceof OAuthError && err.code === "access_denied") {
            const request = oauthService.validateAuthorizationRequest(form);
            return html(res, err.status, consentPage(request, err.message), {
              allowedFormActionOrigins: formActionOrigins(request)
            });
          }
          throw err;
        }
      }
      if (url.pathname === "/oauth/token" && req.method === "POST") {
        const form = await readForm(req);
        const credentials = clientCredentials(req, form);
        const result = await oauthService.exchangeToken({ ...form, ...credentials });
        return json(res, 200, result);
      }
      return json(res, 405, { error: "invalid_request", error_description: "Method not allowed." });
    } catch (err) {
      const oauth = err instanceof OAuthError ? err : new OAuthError("server_error", "Alfred could not complete OAuth.", 500);
      const headers = oauth.code === "invalid_client" ? { "www-authenticate": 'Basic realm="Alfred OAuth"' } : {};
      if (url.pathname === "/oauth/authorize") {
        return html(res, oauth.status, `<!doctype html><html lang="es"><meta charset="utf-8"><title>Error OAuth</title><body><h1>No se pudo conectar Alfred</h1><p>${escapeHtml(oauth.message)}</p></body></html>`);
      }
      return json(res, oauth.status, { error: oauth.code, error_description: oauth.message }, headers);
    }
  };
}
