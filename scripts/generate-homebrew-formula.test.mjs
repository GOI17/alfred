#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  main,
  parseFormulaArgs,
  renderFormula
} from "./generate-homebrew-formula.mjs";

const revision = "a".repeat(40);
const sha256 = "b".repeat(64);

test("renders a private formula pinned by tag and revision", () => {
  const formula = renderFormula({ source: "git", version: "0.5.0", revision });
  assert.match(formula, /class Alfred < Formula/);
  assert.match(formula, /# typed: strict/);
  assert.match(formula, /tag:\s+"v0\.5\.0"/);
  assert.match(formula, new RegExp(`revision: "${revision}"`));
  assert.match(formula, /depends_on "node"/);
  assert.match(formula, /formula_opt_bin\("node"\)/);
  assert.match(formula, /packages\/memory-server\/scripts\/alfred\.mjs/);
  assert.match(formula, /--no-clone/);
  assert.match(formula, /ALFRED_INSTALL_FORCE_TUI=1/);
  assert.match(formula, /Provider calls: 0/);
  assert.doesNotMatch(formula, /sha256/);
});

test("renders a public archive formula pinned by SHA-256", () => {
  const formula = renderFormula({ source: "archive", version: "0.5.0", sha256 });
  assert.match(formula, /archive\/refs\/tags\/v0\.5\.0\.tar\.gz/);
  assert.match(formula, new RegExp(`sha256 "${sha256}"`));
  assert.doesNotMatch(formula, /revision:/);
});

test("rejects malformed and contradictory source pins", () => {
  const output = join(tmpdir(), "alfred.rb");
  assert.throws(
    () => parseFormulaArgs(["--version", "0.5", "--revision", revision, "--output", output]),
    /semantic version/
  );
  assert.throws(
    () => parseFormulaArgs(["--version", "0.5.0", "--source", "git", "--sha256", sha256, "--revision", revision, "--output", output]),
    /does not accept --sha256/
  );
  assert.throws(
    () => parseFormulaArgs(["--version", "0.5.0", "--source", "archive", "--sha256", "bad", "--output", output]),
    /64 lowercase hexadecimal/
  );
  assert.throws(
    () => parseFormulaArgs(["--version", "0.5.0", "--revision", revision, "--output", join(tmpdir(), "wrong.rb")]),
    /alfred\.rb/
  );
  assert.throws(
    () => parseFormulaArgs(["--version", "0.5.0", "--revision", revision, "--output", output, "--wat"]),
    /Unknown argument/
  );
});

test("writes the generated formula atomically", () => {
  const directory = mkdtempSync(join(tmpdir(), "alfred-homebrew-test-"));
  try {
    const output = join(directory, "Formula", "alfred.rb");
    const exitCode = main([
      "--version", "0.5.0",
      "--source", "git",
      "--revision", revision,
      "--output", output
    ]);
    assert.equal(exitCode, 0);
    assert.match(readFileSync(output, "utf8"), /version "0\.5\.0"/);
    assert.equal(statSync(output).mode & 0o777, 0o644);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
