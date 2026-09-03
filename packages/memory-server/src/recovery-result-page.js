import { randomBytes } from "node:crypto";

const RECOVERY_STATES = {
  success: {
    eyebrow: "Recovery complete",
    title: "Your new API key is ready",
    summary: "Your previous API key has been revoked. Update every service that used it.",
    actionLabel: "Continue to Alfred Memory"
  },
  expired: {
    eyebrow: "Link expired",
    title: "This recovery link has expired",
    summary: "No new API key was shown. Return to Alfred Memory and request another recovery email.",
    actionLabel: "Request another recovery link"
  },
  invalid: {
    eyebrow: "Link not recognized",
    title: "This recovery link is invalid",
    summary: "No new API key was shown. Check that you opened the complete link, or request another recovery email.",
    actionLabel: "Request another recovery link"
  },
  used: {
    eyebrow: "Link already used",
    title: "This recovery link has already been used",
    summary: "For your security, a recovery link can show its new API key only once. Request another recovery email if you did not save it.",
    actionLabel: "Request another recovery link"
  },
  unavailable: {
    eyebrow: "Recovery unavailable",
    title: "Alfred could not complete recovery",
    summary: "No new API key was shown. Return to Alfred Memory and try again later.",
    actionLabel: "Return to Alfred Memory"
  }
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createNonce() {
  return randomBytes(18).toString("base64url");
}

function recoveryHeaders(nonce, contentType) {
  return {
    "content-type": contentType,
    vary: "Accept",
    "cache-control": "no-store",
    pragma: "no-cache",
    expires: "0",
    "content-security-policy": [
      "default-src 'none'",
      `style-src 'nonce-${nonce}'`,
      `script-src 'nonce-${nonce}'`,
      "img-src 'none'",
      "font-src 'none'",
      "connect-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'"
    ].join("; "),
    "referrer-policy": "no-referrer",
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "cross-origin-resource-policy": "same-origin"
  };
}

export function explicitlyAcceptsJson(acceptHeader) {
  if (typeof acceptHeader !== "string") return false;
  return acceptHeader.split(",").some((entry) => {
    const [mediaType, ...parameters] = entry.split(";").map((part) => part.trim().toLowerCase());
    if (mediaType !== "application/json") return false;
    const quality = parameters.find((parameter) => parameter.startsWith("q="));
    return quality === undefined || Number(quality.slice(2)) > 0;
  });
}

export function sendRecoveryJson(res, status, body) {
  const nonce = createNonce();
  res.writeHead(status, recoveryHeaders(nonce, "application/json; charset=utf-8"));
  res.end(JSON.stringify(body) + "\n");
}

function safeContinueUrl(value) {
  if (value === "/console" || value === "/console/") return value;
  if (typeof value !== "string" || !value.startsWith("/oauth/authorize?")) return "/console";
  try {
    const parsed = new URL(value, "https://alfred.invalid");
    return parsed.origin === "https://alfred.invalid" && parsed.pathname === "/oauth/authorize" && !parsed.hash
      ? value
      : "/console";
  } catch {
    return "/console";
  }
}

export function sendRecoveryPage(res, status, {
  state,
  apiKey = null,
  continueUrl = "/console",
  actionLabel = null,
  autoContinue = false
} = {}) {
  const content = RECOVERY_STATES[state] ?? RECOVERY_STATES.unavailable;
  const nonce = createNonce();
  const actionUrl = safeContinueUrl(continueUrl);
  const actionText = actionLabel || content.actionLabel;
  const shouldAutoContinue = state === "success" && autoContinue && actionUrl.startsWith("/oauth/authorize?");
  const autoContinueMeta = shouldAutoContinue
    ? `<meta http-equiv="refresh" content="30;url=${escapeHtml(actionUrl)}">`
    : "";
  const autoContinueNotice = shouldAutoContinue
    ? `<p class="auto-return">Alfred will return to the connection flow in 30 seconds. Copy the new key before continuing.</p>`
    : "";
  const keyMarkup = state === "success" && typeof apiKey === "string"
    ? `
        <section class="key-panel" aria-labelledby="key-label">
          <label id="key-label" for="recovery-key">New API key</label>
          <div class="copy-row">
            <input id="recovery-key" type="text" value="${escapeHtml(apiKey)}" readonly autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="one-time-warning copy-status">
            <button id="copy-key" type="button">Copy key</button>
          </div>
          <p id="one-time-warning" class="warning"><strong>Save this key now.</strong> It will not be shown again after you leave or reload this page.</p>
          <p id="copy-status" class="copy-status" role="status" aria-live="polite" aria-atomic="true"></p>
        </section>`
    : "";
  const copyScript = state === "success" && typeof apiKey === "string"
    ? `
    <script nonce="${nonce}">
      const keyField = document.getElementById("recovery-key");
      const copyButton = document.getElementById("copy-key");
      const copyStatus = document.getElementById("copy-status");

      copyButton.addEventListener("click", async () => {
        let copied = false;
        try {
          if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            await navigator.clipboard.writeText(keyField.value);
            copied = true;
          }
        } catch {}

        if (!copied) {
          keyField.focus();
          keyField.select();
          try { copied = document.execCommand("copy"); } catch {}
        }

        copyStatus.textContent = copied
          ? "Copied. Store the key somewhere secure before leaving this page."
          : "Automatic copy was unavailable. The key is selected; use your device's copy command.";
      });
    </script>`
    : "";

  const document = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  ${autoContinueMeta}
  <title>${content.title} · Alfred Memory</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 1.25rem; background: #0b1020; color: #eef2ff; }
    main { width: min(42rem, 100%); padding: clamp(1.5rem, 5vw, 3rem); border: 1px solid #303a5f; border-radius: 1.25rem; background: #121a31; box-shadow: 0 1.5rem 4rem #02061780; }
    .eyebrow { margin: 0 0 .75rem; color: #a5b4fc; font-size: .8rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
    h1 { margin: 0; max-width: 20ch; font-size: clamp(2rem, 7vw, 3.25rem); line-height: 1.03; letter-spacing: -.035em; }
    .summary { margin: 1.25rem 0 0; max-width: 58ch; color: #cbd5e1; font-size: 1.05rem; line-height: 1.65; }
    .key-panel { margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid #303a5f; }
    label { display: block; margin-bottom: .6rem; font-weight: 700; }
    .copy-row { display: flex; gap: .65rem; align-items: stretch; }
    input { min-width: 0; flex: 1; padding: .85rem 1rem; border: 1px solid #64748b; border-radius: .65rem; background: #070b16; color: #f8fafc; font: 600 .96rem ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    button, .action { border: 0; border-radius: .65rem; padding: .85rem 1rem; background: #c7d2fe; color: #111827; font: inherit; font-weight: 750; cursor: pointer; text-decoration: none; }
    button:hover, .action:hover { background: #e0e7ff; }
    button:focus-visible, .action:focus-visible, input:focus-visible { outline: .2rem solid #fbbf24; outline-offset: .2rem; }
    .warning { margin: 1rem 0 0; color: #fde68a; line-height: 1.55; }
    .copy-status { min-height: 1.5em; margin: .65rem 0 0; color: #bfdbfe; line-height: 1.5; }
    .auto-return { margin: 1rem 0 0; color: #bfdbfe; line-height: 1.55; }
    .actions { margin: 2rem 0 0; }
    @media (max-width: 34rem) { .copy-row { align-items: stretch; flex-direction: column; } button { width: 100%; } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; } }
  </style>
</head>
<body>
  <main aria-labelledby="page-title">
    <p class="eyebrow">${content.eyebrow}</p>
    <h1 id="page-title">${content.title}</h1>
    <p class="summary">${content.summary}</p>${keyMarkup}${autoContinueNotice}
    <p class="actions"><a class="action" href="${escapeHtml(actionUrl)}">${escapeHtml(actionText)}</a></p>
  </main>${copyScript}
</body>
</html>`;

  res.writeHead(status, recoveryHeaders(nonce, "text/html; charset=utf-8"));
  res.end(document);
}
