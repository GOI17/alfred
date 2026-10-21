import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("production image installs the Memory server workspace dependency graph", () => {
  const dockerfile = readFileSync(new URL("../../../Dockerfile", import.meta.url), "utf8");

  assert.match(
    dockerfile,
    /pnpm install --prod --frozen-lockfile --filter @alfred-labs\/memory-server\.\.\./
  );
  assert.match(dockerfile, /RUN node scripts\/check-memory-mcp-production\.mjs/);
});


test("container defaults retain the local-only listener", () => {
  const dockerfile = readFileSync(new URL("../../../Dockerfile", import.meta.url), "utf8");
  assert.match(dockerfile, /ENV ALFRED_MEMORY_BIND=127\.0\.0\.1/);
  assert.doesNotMatch(dockerfile, /0\.0\.0\.0|^EXPOSE /m);
});
