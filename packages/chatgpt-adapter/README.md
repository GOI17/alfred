# ChatGPT adapter contracts

Alfred Memory now runs only as a local loopback service. The managed hosted
endpoint has been retired. Cloud ChatGPT Actions cannot reach this service;
there is no supported cloud Custom GPT connection flow.

Use the [local quickstart](../../docs/QUICKSTART.md) and the console served at
`http://127.0.0.1:3000/console/` with the API key issued by `alfred init`.

This package retains the OpenAPI schema, OAuth-related contracts and proactive
capture instructions for compatibility, local tooling and regression tests.
Keeping those assets does not expose the local service to ChatGPT. Existing
memory data, tenant isolation, API-key hashing, OAuth and capture authorization
are preserved by the server.

Do not enter API keys or OAuth client secrets in a chat. Selectively provide
memory content to external clients only when you intend to share it.
