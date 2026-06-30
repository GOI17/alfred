import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const srcIndex = join(pkgRoot, "src", "index.html");
const distDir = join(pkgRoot, "dist");

test("src/index.html exists and is non-empty", () => {
  assert.ok(existsSync(srcIndex));
  const text = readFileSync(srcIndex, "utf8");
  assert.ok(text.length > 5000, "index.html should be substantial");
});

test("src/index.html has the key UI elements", () => {
  const text = readFileSync(srcIndex, "utf8");
  for (const r of ["<title>", "setKey", "loadTenants", "issueKey", "loadKeys", "apiBase"]) {
    assert.ok(text.includes(r), "missing: " + r);
  }
});

test("npm run build creates dist/index.html", () => {
  const result = spawnSync("node", ["scripts/build.mjs"], { cwd: pkgRoot, encoding: "utf8" });
  assert.equal(result.status, 0, "build failed: " + result.stderr);
  assert.ok(existsSync(join(distDir, "index.html")));
  const text = readFileSync(join(distDir, "index.html"), "utf8");
  // The build script injects window.ALFRED_API_BASE with the default.
  assert.match(text, /window\.ALFRED_API_BASE = "http:\/\/localhost:3000"/);
  assert.match(text, /window\.ALFRED_BUILD_VERSION = /);
});

test("build honors ALFRED_API_BASE env var", () => {
  const result = spawnSync("node", ["scripts/build.mjs"], {
    cwd: pkgRoot,
    env: { ...process.env, ALFRED_API_BASE: "https://alfred.example.com" },
    encoding: "utf8"
  });
  assert.equal(result.status, 0, "build failed: " + result.stderr);
  const text = readFileSync(join(distDir, "index.html"), "utf8");
  assert.match(text, /window\.ALFRED_API_BASE = "https:\/\/alfred\.example\.com"/);
});

test("build is idempotent: second build replaces the first", () => {
  // Run twice; the second should overwrite cleanly.
  const r1 = spawnSync("node", ["scripts/build.mjs"], { cwd: pkgRoot, encoding: "utf8" });
  const r2 = spawnSync("node", ["scripts/build.mjs"], { cwd: pkgRoot, encoding: "utf8" });
  assert.equal(r1.status, 0);
  assert.equal(r2.status, 0);
  const text = readFileSync(join(distDir, "index.html"), "utf8");
  // The script block appears exactly once (sentinel-based dedup).
  // Count only the assignment statements (config injection), not the function body reference.
  const matches = text.match(/window\.ALFRED_API_BASE =/g) || [];
  assert.equal(matches.length, 1, "should not duplicate the injection");
});

test("dist/index.html is self-contained (no external script src)", () => {
  const text = readFileSync(join(distDir, "index.html"), "utf8");
  // No <script src="..."> tags (we are pure inline JS).
  const srcTags = text.match(/<script\s+src=/g) || [];
  assert.equal(srcTags.length, 0, "should be a single inline-JS bundle");
});

test("dist/index.html has CORS-friendly Authorization usage", () => {
  const text = readFileSync(join(distDir, "index.html"), "utf8");
  // Uses Authorization header (Bearer), not cookies, so CORS preflight is simple.
  assert.match(text, /"authorization":\s*"Bearer/);
});

test("vercel.json declares the dist/ output and build command", () => {
  const text = readFileSync(join(pkgRoot, "vercel.json"), "utf8");
  assert.match(text, /"outputDirectory":\s*"dist"/);
  assert.match(text, /"buildCommand":\s*"node scripts\/build\.mjs"/);
});

test("netlify.toml publishes dist/ with the build command", () => {
  const text = readFileSync(join(pkgRoot, "netlify.toml"), "utf8");
  assert.match(text, /publish\s*=\s*"dist"/);
  assert.match(text, /command\s*=\s*"node scripts\/build\.mjs"/);
});

test("GitHub Pages public/.nojekyll exists for Jekyll bypass", () => {
  assert.ok(existsSync(join(pkgRoot, "public", ".nojekyll")));
});
