// CAPTCHA verifier for POST /console/api/bootstrap.
//
// Cloudflare Turnstile is the supported provider. The verification flow:
//
//   1. The browser loads the Turnstile widget, which produces a one-shot
//      token after the user solves the challenge (or, with the "managed"
//      mode, transparently for low-risk users).
//   2. The browser sends the token in the X-Turnstile-Token header (or in
//      the body as `turnstile_token` for clients that can't set custom
//      headers on cross-origin POST).
//   3. The server POSTs the token to Turnstile's siteverify endpoint:
//        POST https://challenges.cloudflare.com/turnstile/v0/siteverify
//        body: { secret, response }
//      and checks the `success` field in the response.
//
// The verifier is OPT-IN. When ALFRED_TURNSTILE_SITE_KEY and
// ALFRED_TURNSTILE_SECRET_KEY are unset, `isEnabled()` returns false
// and `verify()` is a no-op (returns { ok: true, skipped: true }).
// This is the v0.3.1 backward-compat path.

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function createCaptchaVerifier({
  siteKey = process.env.ALFRED_TURNSTILE_SITE_KEY ?? null,
  secretKey = process.env.ALFRED_TURNSTILE_SECRET_KEY ?? null,
  fetchImpl = globalThis.fetch,
  verifyUrl = SITEVERIFY_URL,
  now = () => Date.now()
} = {}) {
  const enabled = Boolean(siteKey && secretKey);

  return {
    isEnabled() { return enabled; },
    siteKey() { return enabled ? siteKey : null; },

    async verify({ token, remoteIp } = {}) {
      if (!enabled) return { ok: true, skipped: true };
      if (typeof token !== "string" || token.length === 0) {
        return { ok: false, error_code: "missing_token", message: "CAPTCHA token is required." };
      }
      // siteverify expects application/x-www-form-urlencoded.
      const body = new URLSearchParams();
      body.set("secret", secretKey);
      body.set("response", token);
      if (typeof remoteIp === "string" && remoteIp.length > 0) body.set("remoteip", remoteIp);
      let res;
      try {
        res = await fetchImpl(verifyUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: body.toString()
        });
      } catch (err) {
        return { ok: false, error_code: "siteverify_unreachable", message: err.message };
      }
      if (!res.ok) {
        return { ok: false, error_code: "siteverify_http_" + res.status, message: "siteverify returned " + res.status };
      }
      let payload;
      try { payload = await res.json(); }
      catch (err) { return { ok: false, error_code: "siteverify_bad_json", message: err.message }; }
      if (payload.success === true) {
        return { ok: true, skipped: false, verified_at: new Date(now()).toISOString() };
      }
      return {
        ok: false,
        error_code: payload["error-codes"]?.[0] ?? "verification_failed",
        message: "Turnstile verification failed: " + (payload["error-codes"]?.join(",") ?? "unknown")
      };
    }
  };
}
