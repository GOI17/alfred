import assert from "node:assert/strict";
import { createHash } from "node:crypto";

// The complete archive body shares this bounded transfer deadline. This is not
// a service readiness timeout: large fixture payloads can exceed five seconds.
export async function downloadSmokeArchive(url, expectedSha256, timeoutMs = 30_000) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    assert.equal(response.status, 200, "Runtime archive HTTP status");
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedSha256, "Runtime archive transfer checksum");
    return bytes;
  } catch (error) {
    throw new Error(`Runtime smoke archive transfer failed (${timeoutMs}ms deadline): ${error.message}`, { cause: error });
  }
}
