const EFFECTIVE_DATE = "October 21, 2026";

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
    <p>Alfred Memory is local memory software published by AlfredLabs. The managed hosted service is retired. It is not ChatGPT's native Memory feature.</p>

    <h2>Information your local installation processes</h2>
    <ul>
      <li>Memory content that you explicitly ask Alfred to create, search, read, update, or delete.</li>
      <li>Memory metadata such as type, namespace, tags, source, timestamps, project identifiers, confidence, and optional expiration dates.</li>
      <li>Optional OAuth authorization data used by clients configured for your Alfred tenant. Authorization codes, access tokens, refresh tokens, API keys, and client secrets are stored only as cryptographic hashes where persistence is required.</li>
      <li>Limited request metadata used for security, troubleshooting, and rate limiting, such as endpoint, method, result, timestamp, and credential hash. Your local process and any database provider you choose may also process operational metadata.</li>
    </ul>

    <h2>How the local software uses information</h2>
    <p>Your installation uses this information to provide Alfred Memory, authenticate users, return requested memories, perform user-requested changes, enforce tenant isolation and scopes, prevent abuse, and diagnose service failures. We do not sell personal information or use memory content for advertising.</p>

    <h2>Clients and database providers</h2>
    <p>Cloud ChatGPT Actions cannot reach the loopback-only Memory service. Local clients and Postgres providers you choose may process data under their own terms and privacy policies. SQLite data stays in the files you configure. The public Memory website provides instructions and does not collect API keys or connect to your local API.</p>

    <h2>Retention and deletion</h2>
    <p>Memories remain until you delete them or an optional expiration date is reached. OAuth artifacts expire or are revoked according to the service configuration. You can review and delete memories through your local Alfred console or API. Deleting a tenant removes its associated Alfred Memory data subject to operational backup retention.</p>

    <h2>Security and choices</h2>
    <p>Alfred uses scoped OAuth access, exact redirect URI matching, tenant isolation, hashed credentials, short-lived authorization codes, rotating refresh tokens, and rate limits. Do not store secrets, passwords, API keys, private keys, raw transcripts, or sensitive personal data as memories. You may revoke access by revoking credentials or rotating your Alfred API key.</p>

    <h2>Children</h2>
    <p>Alfred Memory is not directed to children under 13, and we do not knowingly collect their personal information.</p>

    <h2>Changes and contact</h2>
    <p>Material changes will be reflected on this page with a new effective date. For privacy questions or deletion assistance, email <a href="mailto:alfred.support@alfredlabs.org">alfred.support@alfredlabs.org</a>.</p>
  </main>
</body>
</html>\n`;
}
