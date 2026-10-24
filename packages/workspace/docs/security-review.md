# Security review — bounded source inspection

## Scope and validation

This is a partial source review, not a completed three-hour audit or a penetration test. No host commands, dependency audit, real credentials, external services, commits or pushes were used. Added tests have NOT been executed. Existing code and pre-existing security regression tests were inspected, not attributed to this review.

Reviewed: authentication and HTTP routes, workspace path policy and file tools, Git actions, file reveal, agent terminal execution, browser sessions, MCP permission gate and relevant authentication tests.

## Finding corrected: reusable deterministic session cookie

Previously every successful login returned the same HMAC derived from the server access code. Logout cleared only the browser cookie. Anyone possessing a copied cookie could replay it after logout; the server also did not enforce the advertised 30-day expiration. This requires possession of a valid cookie; it is not an unauthenticated login bypass.

Change in `src/server/auth.ts`:
- Generate independent 256-bit random session tokens.
- Keep only their hashes and expiration timestamps in server memory.
- Validate expiration for each new API request and WebSocket handshake.
- Revoke the current token on logout and rotate it on reauthentication.
- Preserve other devices' sessions.
- Bound the session map to 1,000 entries and prune expired entries on login.
- Preserve existing origin checks, cookie flags, and login rate limiting.

Compatibility: old cookies are invalid. Server restarts now require clients to log in again. This in-memory implementation assumes one server process.

Regression cases added in `tests/auth-sessions.test.ts`: replay after logout, independent devices, expiration at the deadline, rotation, legacy cookie rejection, and isolation between server instances. These tests still require execution.

## Remaining review work and limitations

- Already-established WebSocket and SSE connections are not disconnected by session revocation or expiration. Request-level revocation does not imply termination of active connections or tasks.
- Workspace files are checked before access, but concurrent hostile filesystem changes between validation and use need a dedicated race-condition review. The current checks are not an OS sandbox.
- Agent terminal execution intentionally runs host commands with the user's privileges; environment filtering does not isolate the filesystem.
- Embedded browsing permits local network URLs by design. Threat modeling for remote pages, internal services, popups, browser sandboxing, and inherited process environment remains necessary.
- Git operations run in user repositories; hooks, filters, and repository configuration need explicit trust-boundary review.
- Dependency advisories, builds, TypeScript, regression suites, frontend rendering, OAuth flows, and real deployment configuration have not been validated in this pass.

Do not interpret this report as a claim that the application is free of vulnerabilities or production-hardened.
