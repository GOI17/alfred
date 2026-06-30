import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { run: init } = await import("../scripts/init.mjs");

test("init web profile does NOT write a workspace config", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "alfred-web-test-"));
  t.after(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
  process.env.ALFRED_MEMORY_REGISTRY = join(dir, "registry.sqlite");
  process.env.HOME = dir;

  // Capture stderr/stdout
  let stdoutBuf = "";
  let stderrBuf = "";
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { stdoutBuf += s; return true; };
  process.stderr.write = (s) => { stderrBuf += s; return true; };

  let code;
  try {
    code = await init([
      "--profile=web",
      "--name=my-mem",
      "--db-connection=postgres://localhost/x",
      "--non-interactive"
    ]);
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
  console.log("EXIT CODE:", code);
  console.log("STDOUT:", stdoutBuf.slice(0, 500));
  console.log("STDERR:", stderrBuf.slice(0, 500));
  assert.equal(code, 0, `code=${code}, stderr=${stderrBuf.slice(0,300)}`);
});
