import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertSafePath, atomicWrite, readTree, safeReadFile, stageTree, statOrNull } from "./filesystem.js";
import { fail, identity, planAction, sha256, skillMetadata, validName, validateLock } from "./model.js";
import { acquireSource } from "./sources.js";
import { checkSelection, createTargets, HARNESSES, SCOPES } from "./targets.js";
import { searchSkills } from "./catalog.js";
export { searchSkills } from "./catalog.js";
export { validateSkillDirectory } from "./validation.js";

const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const exclusions = ["plugin/system caches", "legacy and compatibility roots", "custom configuration roots", "ancestor project roots"];

export function createSkillManager({ cwd = process.cwd(), home = os.homedir(), env = process.env, fetch: fetcher = globalThis.fetch, now = () => new Date(), beforeCommit } = {}) {
  const targets = createTargets({ cwd, home, env });
  const plans = new WeakMap();
  const timestamp = () => new Date(now()).toISOString();
  const statePath = (scope) => path.join(targets.roots[scope], ".alfred");
  const lockPath = (scope) => path.join(statePath(scope), "skills-lock.json");

  function trace(operation, data = {}) {
    return { trace_id: `skill-manager-${randomUUID()}`, timestamp: timestamp(), event: "skill_manager_operation", actor: "alfred-skills", data: {
      operation, approval: false, provider_calls: 0, provider_request_decision: "local-only", ...data
    } };
  }

  function readLock(scope) {
    const filename = lockPath(scope);
    assertSafePath(targets.roots[scope], filename, { regularFile: true });
    if (!statOrNull(filename)) return { value: { schemaVersion: 1, installations: [] }, bytes: null, digest: null };
    const { bytes } = safeReadFile(filename);
    let value;
    try { value = JSON.parse(bytes.toString("utf8")); }
    catch { fail("E_INVALID_LOCK", "Cannot parse skills-lock.json; preserve and repair the file before retrying."); }
    validateLock(value, { scope, scopes: targets.roots.project === targets.roots.global ? SCOPES : [scope], targetFor: targets.targetFor, storedTargetFor: targets.storedTargetFor });
    return { value, bytes, digest: sha256(bytes) };
  }

  function observe({ harness, scope, name }, receipt = null) {
    const root = targets.discovery(harness, scope);
    const targetPath = path.join(root.path, name);
    const row = { name, harness, scope, targetPath, management: receipt ? "managed" : "unmanaged", integrity: receipt ? "missing" : "unknown",
      declaredVersion: receipt?.declaredVersion ?? null, source: receipt?.source ?? null,
      installedDigest: receipt?.installedDigest ?? null, observedDigest: null, installedAt: receipt?.installedAt ?? null,
      updatedAt: receipt?.updatedAt ?? null, managedSince: receipt?.managedSince ?? null };
    try {
      assertSafePath(root.base, targetPath);
      if (!statOrNull(targetPath)) return row;
      const snapshot = readTree(targetPath);
      row.observedDigest = snapshot.digest;
      if (receipt) row.integrity = snapshot.digest === receipt.installedDigest ? "intact" : "modified";
      const metadata = skillMetadata(snapshot.files);
      row.description = metadata.description;
      row.observedDeclaredVersion = metadata.declaredVersion;
      if (!receipt) row.declaredVersion = metadata.declaredVersion;
    } catch (error) {
      row.integrity = receipt && row.observedDigest && row.observedDigest !== receipt.installedDigest ? "modified" : "invalid";
      row.diagnostic = { code: error.code ?? "E_READ", message: error.message };
    }
    return row;
  }

  function list(selection = {}) {
    checkSelection(selection);
    const installations = [], diagnostics = [], roots = [], seen = new Set();
    for (const scope of selection.scope ? [selection.scope] : SCOPES) {
      const lock = readLock(scope);
      for (const harness of selection.harness ? [selection.harness] : HARNESSES) {
        const root = targets.discovery(harness, scope);
        roots.push({ harness, scope, path: root.path });
        const receipts = lock.value.installations.filter((row) => row.harness === harness && row.scope === scope);
        const names = new Set(receipts.map((row) => row.name));
        try {
          assertSafePath(root.base, root.path);
          if (statOrNull(root.path)) {
            if (!fs.lstatSync(root.path).isDirectory()) fail("E_UNSAFE_PATH", "Skill discovery root is not a directory.");
            for (const entry of fs.readdirSync(root.path, { withFileTypes: true })) {
              if (!entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink())) names.add(entry.name);
            }
          }
        } catch (error) { diagnostics.push({ path: root.path, code: error.code ?? "E_READ", message: error.message }); }
        for (const name of [...names].sort()) {
          const target = path.join(root.path, name);
          if (seen.has(target)) continue;
          seen.add(target);
          // Running from the home directory can alias project and global Codex
          // roots. Retain the real receipt identity and emit one physical row.
          const receipt = lock.value.installations.find((row) => targets.targetFor(row.harness, row.scope, row.name) === target);
          installations.push(observe(receipt ? { harness: receipt.harness, scope: receipt.scope, name } : { harness, scope, name }, receipt));
        }
      }
    }
    return { status: "ok", installations, diagnostics, coverage: { roots, exclusions }, provider_calls: 0, trace: trace("list", { status: "ok" }) };
  }

  function info(name, selection = {}) {
    validName(name);
    const inventory = list(selection);
    const matches = inventory.installations.filter((row) => row.name === name);
    if (!matches.length) fail("E_NOT_FOUND", `Skill ${name} was not found in the selected roots.`);
    if (matches.length > 1) fail("E_AMBIGUOUS", `Skill ${name} has multiple installations; select --scope and --harness.`);
    return { status: "ok", installation: matches[0], diagnostics: inventory.diagnostics, coverage: inventory.coverage, provider_calls: 0, trace: trace("info", { name, status: "ok" }) };
  }

  function chooseHarness(request, scope, name, lock) {
    if (request.harness) return request.harness;
    const matches = lock.value.installations.filter((row) => row.name === name);
    const candidates = new Set(matches.map((row) => row.harness));
    for (const harness of HARNESSES) {
      const root = targets.discovery(harness, scope);
      assertSafePath(root.base, root.path);
      if (statOrNull(name ? path.join(root.path, name) : root.path)) candidates.add(harness);
    }
    if (!candidates.size) {
      for (const harness of HARNESSES) if (statOrNull(targets.discovery(harness, scope).path)) candidates.add(harness);
    }
    if (candidates.size !== 1) fail("E_AMBIGUOUS", "Choose --harness codex or --harness opencode to identify one installation destination.");
    return [...candidates][0];
  }

  async function prepare(request) {
    if (!request || !["install", "update", "remove"].includes(request.operation)) fail("E_ARGUMENT", "Operation must be install, update or remove.");
    checkSelection(request);
    if (request.operation === "install" && request.name !== undefined && request.skill !== undefined) fail("E_ARGUMENT", "--name and --skill are mutually exclusive selectors.");
    if (request.expectedDigest !== undefined && !/^sha256:[a-f0-9]{64}$/.test(request.expectedDigest)) fail("E_ARGUMENT", "Expected digest must be a full sha256:<64 hexadecimal digits> value.");
    if (request.expectedCommit !== undefined && (!/^[a-f0-9]{40}$/.test(request.expectedCommit) || request.operation === "remove")) fail("E_ARGUMENT", "Expected commit must be a full GitHub commit for add/install/update.");
    const scope = request.scope ?? "project";
    if (scope === "project" && targets.roots.project === targets.roots.global) {
      fail("E_SCOPE_ALIAS", "The selected project is your home directory and shares global skill state. Select --scope global explicitly, or --cwd a separate project directory.");
    }
    const lock = readLock(scope);
    let snapshot = null;
    let name = request.name;
    if (request.operation === "install") {
      snapshot = await acquireSource(request.source, { cwd: targets.roots.project, skill: request.skill, name: request.name, ref: request.ref, fetcher });
      name = snapshot.name;
    } else validName(name);
    const harness = chooseHarness(request, scope, name, lock);
    const root = targets.discovery(harness, scope);
    const targetPath = targets.targetFor(harness, scope, name);
    assertSafePath(root.base, targetPath);
    const receipt = lock.value.installations.find((row) => identity(row) === identity({ scope, harness, name }));
    const aliasReceipt = lock.value.installations.find((row) => identity(row) !== identity({ scope, harness, name }) && targets.targetFor(row.harness, row.scope, row.name) === targetPath);
    if (aliasReceipt) fail("E_SCOPE_ALIAS", `This physical installation is managed as ${aliasReceipt.harness}/${aliasReceipt.scope}; select that scope and harness explicitly.`);
    const current = receipt || statOrNull(targetPath) ? observe({ harness, scope, name }, receipt) : null;
    // Never acquire an update source for an already blocked target.
    if (request.operation === "update" && current?.management === "managed" && current.integrity === "intact") {
      const source = receipt.source;
      snapshot = await acquireSource(source.kind === "local" ? source.path : source.repository, {
        cwd: targets.roots.project, skill: source.kind === "github" ? source.skillPath : undefined,
        ref: request.ref ?? (source.kind === "github" ? source.requestedRef : undefined), fetcher
      });
    }
    // Acquisition can await a slow remote source. The earlier observed tree is
    // not authority to replace files that another process edited meanwhile.
    const afterAcquisition = receipt || statOrNull(targetPath) ? observe({ harness, scope, name }, receipt) : null;
    if (JSON.stringify(afterAcquisition) !== JSON.stringify(current) || readLock(scope).digest !== lock.digest) {
      fail("E_STALE_PLAN", "Destination or receipt changed during source acquisition. Review a new plan.");
    }
    const candidate = snapshot ? { name: snapshot.name, declaredVersion: snapshot.declaredVersion, source: snapshot.source,
      sourceDigest: snapshot.digest, installedDigest: snapshot.digest, files: snapshot.files.map((file) => file.path).sort() } : null;
    const reviewedDigest = request.operation === "remove" ? current?.installedDigest : candidate?.installedDigest;
    if (request.expectedDigest !== undefined && reviewedDigest !== request.expectedDigest) fail("E_STALE_PLAN", "Content differs from the reviewed digest. Review the new plan before applying.");
    if (request.expectedCommit !== undefined && candidate?.source.resolvedCommit !== request.expectedCommit) fail("E_STALE_PLAN", "GitHub revision differs from the reviewed commit. Review the new plan before applying.");
    let decision = planAction(request.operation, current, candidate);
    if (snapshot?.source.kind === "local" && snapshot.source.path === targetPath) decision = { status: "blocked", action: "none", blockers: [{ code: "E_SOURCE_IS_TARGET", message: "The installed directory cannot be its own update source; select an independent source." }] };
    const source = snapshot?.source ?? receipt?.source ?? null;
    const currentFiles = current?.integrity === "intact" ? readTree(targetPath).files.map((file) => file.path) : [];
    const files = [...new Set([...currentFiles, ...(candidate?.files ?? [])])].sort();
    const result = { ...decision, operation: request.operation, name, harness, scope, targetPath, source, candidate, current, files,
      provider_calls: 0, trace: trace(request.operation, { name, scope, harness, source, target: targetPath, status: decision.status,
        reason: decision.blockers[0]?.code ?? null, old_digest: current?.installedDigest ?? null, new_digest: candidate?.installedDigest ?? null,
        source_acquisition: source?.kind === "github" && snapshot ? "github-network" : "local", network_access: source?.kind === "github" && !!snapshot }) };
    const fingerprint = sha256(jsonBytes({ lock: lock.digest, operation: result.operation, action: result.action, name, harness, scope, targetPath,
      source, candidate, current, blockers: result.blockers }));
    return { result, snapshot, lock, fingerprint, root };
  }

  async function plan(request) {
    try {
      const normalized = { ...request, operation: request?.operation === "add" ? "install" : request?.operation };
      const prepared = await prepare(normalized);
      plans.set(prepared.result, { request: normalized, fingerprint: prepared.fingerprint });
      return prepared.result;
    } catch (error) {
      error.trace = trace(request?.operation ?? "unknown", { status: "failed", reason: error.code ?? "E_IO" });
      throw error;
    }
  }

  function persistTrace(scope, event) {
    const target = path.join(statePath(scope), "observability", `${event.trace_id}.json`);
    atomicWrite(targets.roots[scope], target, jsonBytes(event));
  }

  async function apply(planValue, { approval = false, dryRun = false } = {}) {
    const saved = plans.get(planValue);
    if (!saved) fail("E_STALE_PLAN", "Apply requires a plan created by this manager instance.");
    if (dryRun) return planValue;
    if (approval !== true) fail("E_APPROVAL_REQUIRED", "Explicit approval is required to apply a skill operation.");
    // Derive every mutation parameter from the private request, never caller-
    // mutable plan fields or untrusted receipt target paths.
    const scope = saved.request.scope ?? "project";
    const state = statePath(scope);
    const base = targets.roots[scope];
    const guard = path.join(state, "skills-operation.lock");
    assertSafePath(base, guard, { regularFile: true });
    fs.mkdirSync(state, { recursive: true });
    assertSafePath(base, guard, { regularFile: true });
    let descriptor;
    try { descriptor = fs.openSync(guard, "wx", 0o600); }
    catch (error) {
      if (error.code === "EEXIST") fail("E_BUSY", `Another skill operation holds ${guard}. If a previous process stopped, inspect its transaction files before removing this guard.`);
      throw error;
    }
    let prepared, transaction, backup, staged, treeChanged = false, targetInstalled = false, lockWritten = false;
    try {
      fs.writeFileSync(descriptor, jsonBytes({ pid: process.pid, startedAt: timestamp() }));
      prepared = await prepare(saved.request);
      if (prepared.fingerprint !== saved.fingerprint) fail("E_STALE_PLAN", "Source, destination or receipt changed since preview. Generate and review a new plan.");
      const result = prepared.result;
      if (result.status === "blocked") fail("E_BLOCKED", result.blockers.map((item) => item.message).join(" "));
      if (result.status === "unchanged") {
        result.trace.data.approval = true;
        persistTrace(scope, result.trace);
        return result;
      }
      const target = result.targetPath;
      const { root, lock, snapshot } = prepared;
      assertSafePath(root.base, target);
      if (result.action !== "adopt") {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        assertSafePath(root.base, target);
        transaction = path.join(path.dirname(target), `.alfred-skill-transaction-${randomUUID()}`);
        fs.mkdirSync(transaction, { mode: 0o700 });
        backup = path.join(transaction, "previous");
        staged = path.join(transaction, "candidate");
        if (snapshot) {
          stageTree(staged, snapshot.files);
          if (readTree(staged).digest !== snapshot.digest) fail("E_STAGE", "Staged package did not match the reviewed snapshot.");
        }
        const oldReceipt = lock.value.installations.find((row) => identity(row) === identity(result));
        const currentNow = oldReceipt || statOrNull(target) ? observe(result, oldReceipt) : null;
        if (JSON.stringify(currentNow) !== JSON.stringify(result.current) || readLock(scope).digest !== lock.digest) {
          fail("E_STALE_PLAN", "Destination or receipt changed before applying. Review a new plan.");
        }
        assertSafePath(root.base, target);
        if (statOrNull(target)) { fs.renameSync(target, backup); treeChanged = true; }
        if (snapshot) { fs.renameSync(staged, target); treeChanged = true; targetInstalled = true; }
      }
      if (beforeCommit) await beforeCommit({ operation: result.operation, action: result.action, targetPath: target, lockPath: lockPath(scope) });
      assertSafePath(root.base, target);
      if (snapshot && readTree(target).digest !== snapshot.digest) fail("E_STALE_PLAN", "Destination changed while applying; operation is rolling back.");
      if (result.action === "remove" && statOrNull(target)) fail("E_STALE_PLAN", "Destination was recreated during removal; preserve it and recover the previous package from the transaction backup.");
      if (readLock(scope).digest !== lock.digest) fail("E_STALE_PLAN", "Receipt changed while applying; operation is rolling back.");
      const updatedAt = timestamp();
      const previous = lock.value.installations.find((row) => identity(row) === identity(result));
      const receipt = result.action === "remove" ? null : {
        name: result.name, harness: result.harness, scope, targetPath: targets.storedTargetFor(target, scope), source: snapshot.source,
        declaredVersion: snapshot.declaredVersion, sourceDigest: snapshot.digest, installedDigest: snapshot.digest,
        installedAt: previous ? previous.installedAt : result.action === "adopt" ? null : updatedAt,
        managedSince: previous?.managedSince ?? updatedAt, updatedAt
      };
      const installations = lock.value.installations.filter((row) => identity(row) !== identity(result));
      if (receipt) installations.push(receipt);
      installations.sort((a, b) => identity(a).localeCompare(identity(b)));
      atomicWrite(base, lockPath(scope), jsonBytes({ schemaVersion: 1, installations }));
      lockWritten = true;
      result.status = "applied";
      result.receipt = receipt;
      result.trace.data.status = "applied";
      result.trace.data.approval = true;
      persistTrace(scope, result.trace);
      plans.delete(planValue);
      return result;
    } catch (error) {
      let recoveryError;
      try {
        if (lockWritten) {
          if (prepared.lock.bytes) atomicWrite(base, lockPath(scope), prepared.lock.bytes);
          else fs.unlinkSync(lockPath(scope));
        }
        if (treeChanged) {
          const target = prepared.result.targetPath;
          assertSafePath(prepared.root.base, target);
          if (targetInstalled && statOrNull(target)) fs.rmSync(target, { recursive: true });
          if (!targetInstalled && statOrNull(target)) fail("E_STALE_PLAN", "A new destination appeared while removing the old package; its content was preserved.");
          if (statOrNull(backup)) fs.renameSync(backup, target);
        }
      } catch (rollbackError) { recoveryError = rollbackError; }
      const failureTrace = trace(saved.request.operation, { status: error.code === "E_BLOCKED" ? "blocked" : "failed", approval: true, scope, reason: error.code ?? "E_IO",
        name: prepared?.result.name ?? saved.request.name ?? null, harness: prepared?.result.harness ?? saved.request.harness ?? null,
        source: prepared?.result.source ?? null, target: prepared?.result.targetPath ?? null,
        recovery_required: !!recoveryError, recovery_path: recoveryError ? transaction : null });
      try { persistTrace(scope, failureTrace); } catch { /* Preserve the operation/rollback failure. */ }
      error.trace = failureTrace;
      if (recoveryError) {
        transaction = null; // Preserve backup data for explicit recovery.
        fail("E_RECOVERY_REQUIRED", `Skill operation failed (${error.message}); rollback needs attention (${recoveryError.message}). Recovery path: ${failureTrace.data.recovery_path}`);
      }
      throw error;
    } finally {
      if (transaction) { try { fs.rmSync(transaction, { recursive: true }); } catch { /* Hidden transaction is safe to inspect/clean later. */ } }
      fs.closeSync(descriptor);
      try { fs.unlinkSync(guard); } catch { /* Never hide the primary operation result. */ }
    }
  }

  return { list, info, plan, apply, search: (query, options = {}) => searchSkills(query, { ...options, fetch: fetcher, now }) };
}
