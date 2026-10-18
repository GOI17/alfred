#!/usr/bin/env node
// Dependencies are staged explicitly; this build never downloads a toolchain or modules.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const setupTargets = ["darwin-amd64", "darwin-arm64", "linux-amd64", "linux-arm64"];
export function setupBuildPlan(root, output, inherited = process.env) {
  return setupTargets.map((target) => {
    const [GOOS, GOARCH] = target.split("-");
    return {
      target,
      cwd: join(root, "packages/setup-tui"),
      executable: join(output, `alfred-setup-${target}`),
      args: ["build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -buildid=", "-o", join(output, `alfred-setup-${target}`), "."],
      env: { ...inherited, GOENV: "off", GOWORK: "off", GOFLAGS: "", GOEXPERIMENT: "", GOTOOLCHAIN: "local", CGO_ENABLED: "0", GOPROXY: "off", GOSUMDB: "off", GOOS, GOARCH, GOAMD64: "v1", GOARM64: "v8.0" }
    };
  });
}
export function verifySetupBuildInfo(info, target) {
  const lines = info.split("\n").map((line) => line.trim().split(/\s+/));
  for (const [module, version] of [["github.com/charmbracelet/bubbletea", "v0.25.0"], ["github.com/charmbracelet/lipgloss", "v0.9.1"]]) {
    if (!lines.some((line) => line[0] === "dep" && line[1] === module && line[2] === version)) throw new Error(`Setup TUI build must link ${module} ${version}`);
  }
  const [platform, architecture] = target.split("-");
  for (const setting of ["CGO_ENABLED=0", "-trimpath=true", `GOOS=${platform}`, `GOARCH=${architecture}`]) {
    if (!lines.some((line) => line[0] === "build" && line[1] === setting)) throw new Error(`Setup TUI build lacks ${setting}`);
  }
  if (lines.some((line) => line[0] === "=>" || line[0] === "build" && line[1]?.startsWith("vcs"))) throw new Error("Setup TUI build contains replacements or source checkout metadata");
}
export function buildSetupTui({ root = repositoryRoot, output = join(root, "packages/setup-tui/dist"), env = process.env } = {}) {
  root = resolve(root); output = resolve(output);
  mkdirSync(output, { recursive: true });
  const temporary = mkdtempSync(join(output, ".build-"));
  try {
    const plan = setupBuildPlan(root, temporary, env);
    for (const build of plan) {
      const result = spawnSync("go", build.args, { cwd: build.cwd, env: build.env, encoding: "utf8" });
      if (result.error || result.status !== 0) throw new Error(`Setup TUI build failed (${build.target}); stage pinned Go modules explicitly before building. ${result.error?.message ?? result.stderr}`);
      const metadata = spawnSync("go", ["version", "-m", build.executable], { cwd: build.cwd, env: build.env, encoding: "utf8" });
      if (metadata.error || metadata.status !== 0) throw new Error(`Cannot inspect setup TUI build metadata: ${build.target}`);
      verifySetupBuildInfo(metadata.stdout, build.target);
      chmodSync(build.executable, 0o755);
    }
    const binaries = Object.fromEntries(plan.map((build) => [build.target, { file: `alfred-setup-${build.target}`, sha256: createHash("sha256").update(readFileSync(build.executable)).digest("hex") }]));
    writeFileSync(join(temporary, "manifest.json"), JSON.stringify({ schema: "alfred.setup.binaries/v1", binaries }, null, 2) + "\n");
    // No final binary is replaced until every target compiles successfully.
    for (const build of plan) renameSync(build.executable, join(output, `alfred-setup-${build.target}`));
    renameSync(join(temporary, "manifest.json"), join(output, "manifest.json"));
    return { event: "setup_tui_built", targets: setupTargets, output, provider_calls: 0, network: "disabled" };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      if (!["--root", "--output"].includes(process.argv[i]) || !process.argv[i + 1]) throw new Error("Usage: build-setup-tui.mjs [--root PATH] [--output PATH]");
      options[process.argv[i].slice(2)] = process.argv[i + 1];
    }
    process.stdout.write(`${JSON.stringify(buildSetupTui(options))}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
