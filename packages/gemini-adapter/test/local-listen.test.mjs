import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("shipped Gemini bridge listens on loopback with an ephemeral port", async (t) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("ALFRED_")));
  const child = spawn(process.execPath, [fileURLToPath(new URL("../bin/bridge.mjs", import.meta.url))], {
    env: { ...env, ALFRED_MEMORY_BASE_URL: "http://127.0.0.1:1", ALFRED_MEMORY_API_KEY: "fixture-only", ALFRED_MEMORY_BRIDGE_PORT: "0" }, stdio: ["ignore", "ignore", "pipe"]
  });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; } });
  const endpoint = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("bridge startup timed out")), 5000);
    child.once("error", reject);
    child.once("exit", () => { clearTimeout(timeout); reject(new Error("bridge exited before listening")); });
    child.stderr.on("data", chunk => {
      output += chunk;
      const match = output.match(/listening on (http:\/\/127\.0\.0\.1:(\d+))/);
      if (match && Number(match[2]) > 0) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  const response = await fetch(endpoint + "/memories");
  assert.equal(response.status, 502); // Deliberately absent local upstream, no external request.
  assert.equal((await response.json()).error.code, "upstream_error");
});
