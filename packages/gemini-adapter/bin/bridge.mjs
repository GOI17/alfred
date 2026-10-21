#!/usr/bin/env node
// Run the Gemini / Google AI Studio bridge HTTPS server.
import https from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { createBridge, createBridgeServer } from "../src/bridge.mjs";

const baseUrl = process.env.ALFRED_MEMORY_BASE_URL;
const apiKey = process.env.ALFRED_MEMORY_API_KEY;
const port = Number(process.env.ALFRED_MEMORY_BRIDGE_PORT ?? 8788);
const cert = process.env.ALFRED_MEMORY_BRIDGE_TLS_CERT;
const key = process.env.ALFRED_MEMORY_BRIDGE_TLS_KEY;

if (!baseUrl || !apiKey) {
  process.stderr.write("Required: ALFRED_MEMORY_BASE_URL and ALFRED_MEMORY_API_KEY\n");
  process.exit(2);
}

const bridge = createBridgeServer({ baseUrl, apiKey });

if (cert && key && existsSync(cert) && existsSync(key)) {
  const opts = { cert: readFileSync(cert), key: readFileSync(key) };
  const server = https.createServer(opts, createBridge({ baseUrl, apiKey }));
  server.listen(port, "127.0.0.1", () => process.stderr.write(`gemini-bridge listening on https://127.0.0.1:${server.address().port} -> ${baseUrl}\n`));
} else {
  bridge.listen(port, "127.0.0.1", () => process.stderr.write(`gemini-bridge listening on http://127.0.0.1:${bridge.address().port} -> ${baseUrl}\n`));
}
