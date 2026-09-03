const EFFECTIVE_DATE = "September 2, 2026";

export function renderPrivacyPolicyPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Alfred Memory Privacy Policy</title>
</head>
<body>
  <main>
    <h1>Alfred Memory Privacy Policy</h1>
    <p><strong>Effective date:</strong> ${EFFECTIVE_DATE}</p>
    <p>Alfred Memory is an external, self-hostable memory service used by the Alfred Memory Custom GPT. It is not ChatGPT's native Memory feature.</p>

    <h2>Information we process</h2>
    <ul>
      <li>Memory content that you explicitly ask Alfred to create, search, read, update, or delete.</li>
      <li>Memory metadata such as type, namespace, tags, source, timestamps, project identifiers, confidence, and optional expiration dates.</li>
      <li>OAuth authorization data required to connect ChatGPT to your Alfred tenant. Authorization codes, access tokens, refresh tokens, API keys, and client secrets are stored only as cryptographic hashes where persistence is required.</li>
      <li>Limited request metadata used for security, troubleshooting, and rate limiting, such as endpoint, method, result, timestamp, and credential hash. Hosting infrastructure may also process IP addresses and standard network logs.</li>
    </ul>

    <h2>How we use information</h2>
    <p>We use this information only to provide Alfred Memory, authenticate users, return requested memories, perform user-requested changes, enforce tenant isolation and scopes, prevent abuse, and diagnose service failures. We do not sell personal information or use memory content for advertising.</p>

    <h2>ChatGPT and service providers</h2>
    <p>When you invoke an Alfred Action, the request and response needed to complete that Action pass between ChatGPT and the Alfred Memory API. OpenAI processes that data under its own terms and privacy policy. Infrastructure providers may process encrypted or operational data solely to host and secure the service.</p>

    <h2>Retention and deletion</h2>
    <p>Memories remain until you delete them or an optional expiration date is reached. OAuth artifacts expire or are revoked according to the service configuration. You can review and delete memories through the Alfred Memory Custom GPT or Alfred console. Deleting a tenant removes its associated Alfred Memory data subject to operational backup retention.</p>

    <h2>Security and choices</h2>
    <p>Alfred uses scoped OAuth access, exact redirect URI matching, tenant isolation, hashed credentials, short-lived authorization codes, rotating refresh tokens, and rate limits. Do not store secrets, passwords, API keys, private keys, raw transcripts, or sensitive personal data as memories. You may revoke access by disconnecting the Action or rotating your Alfred API key.</p>

    <h2>Children</h2>
    <p>Alfred Memory is not directed to children under 13, and we do not knowingly collect their personal information.</p>

    <h2>Changes and contact</h2>
    <p>Material changes will be reflected on this page with a new effective date. For privacy questions or deletion assistance, open an issue in the <a href="https://github.com/GOI17/alfred/issues">Alfred repository</a>.</p>
  </main>
</body>
</html>\n`;
}

