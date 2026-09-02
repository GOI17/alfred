#!/usr/bin/env node

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY = "GOI17/alfred";

function fail(message) {
  throw new Error(message);
}

function valueFor(argv, index, name) {
  const argument = argv[index];
  const prefix = `--${name}=`;
  if (argument.startsWith(prefix)) return { value: argument.slice(prefix.length), consumed: 1 };
  if (argument === `--${name}`) {
    if (index + 1 >= argv.length || argv[index + 1].startsWith("--")) {
      fail(`Missing value for --${name}`);
    }
    return { value: argv[index + 1], consumed: 2 };
  }
  return null;
}

export function parseFormulaArgs(argv) {
  const options = { source: "git" };
  const supported = ["version", "source", "revision", "sha256", "output"];
  for (let index = 0; index < argv.length;) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    let matched = false;
    for (const name of supported) {
      const parsed = valueFor(argv, index, name);
      if (!parsed) continue;
      if (Object.hasOwn(options, name) && name !== "source") fail(`Duplicate --${name}`);
      options[name] = parsed.value;
      index += parsed.consumed;
      matched = true;
      break;
    }
    if (!matched) fail(`Unknown argument: ${argument}`);
  }

  if (!/^\d+\.\d+\.\d+$/.test(options.version ?? "")) {
    fail("--version must be semantic version X.Y.Z");
  }
  if (!['git', 'archive'].includes(options.source)) {
    fail("--source must be git or archive");
  }
  if (!options.output || basename(options.output) !== "alfred.rb") {
    fail("--output must end with the Homebrew formula filename alfred.rb");
  }
  if (options.source === "git") {
    if (!/^[0-9a-f]{40}$/.test(options.revision ?? "")) {
      fail("Git source requires --revision as 40 lowercase hexadecimal characters");
    }
    if (options.sha256 !== undefined) fail("Git source does not accept --sha256");
  } else {
    if (!/^[0-9a-f]{64}$/.test(options.sha256 ?? "")) {
      fail("Archive source requires --sha256 as 64 lowercase hexadecimal characters");
    }
    if (options.revision !== undefined) fail("Archive source does not accept --revision");
  }
  return options;
}

function sourceStanza({ source, version, revision, sha256 }) {
  if (source === "git") {
    return `  url "https://github.com/${REPOSITORY}.git",\n` +
      `      tag:      "v${version}",\n` +
      `      revision: "${revision}"`;
  }
  return `  url "https://github.com/${REPOSITORY}/archive/refs/tags/v${version}.tar.gz"\n` +
    `  sha256 "${sha256}"`;
}

export function renderFormula(options) {
  return `# typed: strict
# frozen_string_literal: true

class Alfred < Formula
  desc "Agent operations runtime for coding harnesses"
  homepage "https://alfred.alfredlabs.org"
${sourceStanza(options)}

  depends_on "node"

  def install
    libexec.install Dir["*"]
    libexec.install ".ai"
    chmod 0755, libexec/"install.sh"

    (bin/"alfred").write <<~SH
      #!/bin/sh
      ALFRED_DISTRIBUTION=homebrew exec "#{formula_opt_bin("node")}/node" "#{libexec}/packages/memory-server/scripts/alfred.mjs" "$@"
    SH
  end

  def caveats
    <<~EOS
      Alfred is installed preview-first. Run the guided setup with:
        alfred setup

      The formula does not write live harness configuration during installation.
    EOS
  end

  test do
    assert_equal "alfred #{version}", shell_output("#{bin}/alfred version").strip
    output = shell_output("#{bin}/alfred setup --edition=coding --name=brew-test --harness=none")
    assert_match "ALFRED SUITE INSTALL PREVIEW", output
    assert_match "Provider calls: 0", output
  end
end
`;
}

export function writeFormulaAtomic(outputPath, contents) {
  const target = resolve(outputPath);
  const targetDirectory = dirname(target);
  mkdirSync(targetDirectory, { recursive: true });
  const temporary = resolve(targetDirectory, `.alfred.rb.${process.pid}.${Date.now()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o644);
    writeFileSync(descriptor, contents, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, target);
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

function usage() {
  return [
    "Generate Alfred's Homebrew formula.",
    "",
    "Private Git source:",
    "  node scripts/generate-homebrew-formula.mjs --version X.Y.Z --source git --revision <40-hex> --output Formula/alfred.rb",
    "",
    "Public archive source:",
    "  node scripts/generate-homebrew-formula.mjs --version X.Y.Z --source archive --sha256 <64-hex> --output Formula/alfred.rb"
  ].join("\n");
}

export function main(argv = process.argv.slice(2)) {
  const options = parseFormulaArgs(argv);
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return 0;
  }
  writeFormulaAtomic(options.output, renderFormula(options));
  process.stdout.write(`${JSON.stringify({
    status: "pass",
    source: options.source,
    version: options.version,
    output: resolve(options.output),
    provider_calls: 0
  })}\n`);
  return 0;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`homebrew-formula: ${error.message}\n`);
    process.exitCode = 1;
  }
}
