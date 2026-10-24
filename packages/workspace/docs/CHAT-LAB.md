# Chat regression lab

Reusable local integration environment for developers and future agent sessions. Uses the real UI, authentication, HTTP routes, SSE, queue and persistence with a deterministic injected model. No production credentials or workspace data are loaded. Data and the Git fixture live in a temporary directory, removed on normal shutdown.

## Run

```sh
pnpm install
pnpm browser:install
pnpm test:chat
```

Playwright starts its own server on `127.0.0.1:4312`; it refuses to reuse an existing server. Stop a manually running lab before testing. Desktop Chrome and Pixel 7 emulation run serially. Device connection tests also run in WebKit with an iPhone viewport; `pnpm browser:install` installs both engines. No build is required.

## Manual reproduction

```sh
pnpm lab:chat
```

Open http://127.0.0.1:4312 and enter the synthetic code `alfred-chat-lab-only`. Select the fixture conversation from the sidebar. Send a prompt containing `[slow]` to delay model startup by three seconds, then enqueue another prompt, stop, reload or use browser network offline emulation. Ordinary prompts stream two chunks. Ctrl+C stops the lab and removes its temporary data; forced termination may leave the temporary fixture behind.

Do not expose this lab through a tunnel. Do not add real keys or enable terminal/MCP capabilities. Server-side fetch fails closed; the injected model must take precedence over configured providers. This is not a general-purpose network sandbox.

## Automated scenarios

- Real composer submission, FIFO processing, final idle state and reload.
- Stop followed by a new idle submission without manually resuming the queue.
- Browser offline/online recovery while the server completes a response.
- Reload during an active response, checking that the prompt is not duplicated and another prompt can be submitted afterward.

Each scenario runs on desktop and phone (eight cases total). The server fixture is shared across serial cases; use baseline counts and project-specific prompt text when asserting uniqueness. API calls are used for precise queue setup and state assertions; the composer and browser event channel remain real. This does not emulate Cloudflare, provider outages, large SSE backpressure or real hardware mobile browsers.

Run `pnpm test:chat tests/device-connection.spec.ts` for QR pairing regressions. These use a synthetic camera stream with a real QR image and decoder, cover camera cleanup and denied permissions, verify same-server validation and clipboard handoff, and authenticate against the lab server. They do not verify Home Screen installation or physical iPhone camera permissions.

## Evidence

Failure artifacts (screenshot, video, trace): `test-results/chat-lab/`.

```sh
pnpm exec playwright show-report playwright-report/chat-lab
pnpm exec playwright show-trace <path-to-trace.zip>
```

A non-fatal Vite HMR websocket warning may appear if another development server owns port 24678; the lab HTTP/SSE endpoint is port 4312.

## Future changes

For queue, streaming or reconnect changes, run `pnpm test:chat` alongside targeted unit tests and `pnpm tc`. Add a regression scenario before claiming a fix. Prefer locator assertions and bounded polling over sleeps. Extend the mock in `tests/chat-lab-server.ts` for deterministic faults; do not introduce production fault endpoints or bypass authentication. Keep this suite excluded from the ordinary production-build Playwright configuration.

The mock does not establish compatibility with real providers. Record separately any real-provider testing. TypeScript currently also reports pre-existing errors in workspace-files.ts and workspace-batch.test.ts; do not describe the global build as passing until resolved.
