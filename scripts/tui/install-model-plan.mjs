import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fsyncSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";

function restrictedModelPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("invalid model plan");
  if (JSON.stringify(Object.keys(plan).sort()) !== JSON.stringify(["models", "provider_calls", "schema", "strategy"])) throw new Error("model plan has unknown keys");
  if (plan.schema !== "alfred.install.model-plan/v1" || plan.strategy !== "custom-models" || plan.provider_calls !== 0) throw new Error("invalid model plan contract");
  const keys = Object.keys(plan.models ?? {});
  if (keys.some((key) => !["*", "orchestrator", "developer", "fallbacks"].includes(key)) || !Object.hasOwn(plan.models ?? {}, "*") || !Object.hasOwn(plan.models ?? {}, "fallbacks")) throw new Error("invalid models keys");
  for (const key of ["*", "orchestrator", "developer"]) {
    if (!Object.hasOwn(plan.models, key)) continue;
    const entry = plan.models[key];
    if (!entry || Array.isArray(entry) || typeof entry !== "object" || JSON.stringify(Object.keys(entry)) !== JSON.stringify(["primary"])) throw new Error(`invalid ${key} model entry`);
  }
  if (!Array.isArray(plan.models.fallbacks)) throw new Error("invalid global fallbacks");
  return plan;
}

export function writePrivateModelPlan(filePath, plan) {
  const target = resolve(filePath);
  const parent = dirname(target);
  if (basename(target) !== "model-plan.json") throw new Error("model plan path must use the fixed model-plan.json filename");
  const effectiveUid = typeof process.geteuid === "function" ? process.geteuid() : null;
  const parentStats = lstatSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) throw new Error("model plan parent must be a regular non-symlink directory");
  if ((parentStats.mode & 0o777) !== 0o700) throw new Error("model plan parent must have private mode 0700");
  if (effectiveUid !== null && parentStats.uid !== effectiveUid) throw new Error("model plan parent must be owned by the effective uid");
  const existing = lstatSync(target);
  if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("model plan target must be a regular non-symlink file");
  if ((existing.mode & 0o777) !== 0o600) throw new Error("model plan target must have mode 0600");
  if (effectiveUid !== null && existing.uid !== effectiveUid) throw new Error("model plan target must be owned by the effective uid");
  const bytes = Buffer.from(`${JSON.stringify(restrictedModelPlan(plan), null, 2)}\n`, "utf8");
  const temporaryPath = join(parent, `.${basename(target)}.${process.pid}.${Date.now()}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporaryPath, target);
    const directoryDescriptor = openSync(parent, constants.O_RDONLY);
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {}
    }
    try {
      unlinkSync(temporaryPath);
    } catch {}
    throw error;
  }
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
