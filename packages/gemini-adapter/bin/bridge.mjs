#!/usr/bin/env node
// Run the Gemini / Google AI Studio bridge HTTPS server.
import http from "node:http";
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
  const server = https.createServer(opts, bridge);
  server.listen(port, () => process.stderr.write(`gemini-bridge listening on https://*:${port} -> ${baseUrl}\n`));
} else {
  bridge.listen(port, () => process.stderr.write(`gemini-bridge listening on http://*:${port} -> ${baseUrl}\n`));
}
