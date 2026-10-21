import path from "node:path";
import { canonicalRoot } from "./filesystem.js";
import { fail, validName } from "./model.js";

export const HARNESSES = ["codex", "opencode"];
export const SCOPES = ["project", "global"];

export function checkSelection({ harness, scope } = {}) {
  if (harness !== undefined && !HARNESSES.includes(harness)) fail("E_ARGUMENT", "--harness must be codex or opencode.");
  if (scope !== undefined && !SCOPES.includes(scope)) fail("E_ARGUMENT", "--scope must be project or global.");
}

// Discovery semantics belong here, outside receipt validation and plan rules.
export function createTargets({ cwd, home, env }) {
  const roots = { project: canonicalRoot(cwd), global: canonicalRoot(home) };
  if (env.XDG_CONFIG_HOME && !path.isAbsolute(env.XDG_CONFIG_HOME)) fail("E_ARGUMENT", "XDG_CONFIG_HOME must be an absolute path.");
  const configRoot = env.XDG_CONFIG_HOME ? canonicalRoot(env.XDG_CONFIG_HOME) : path.join(roots.global, ".config");
  function discovery(harness, scope) {
    checkSelection({ harness, scope });
    const base = scope === "global" && harness === "opencode" ? configRoot : roots[scope];
    const directory = scope === "global" && harness === "opencode"
      ? path.join(base, "opencode", "skills")
      : path.join(base, harness === "codex" ? ".agents" : ".opencode", "skills");
    return { harness, scope, base, path: directory };
  }
  function targetFor(harness, scope, name) {
    validName(name);
    return path.join(discovery(harness, scope).path, name);
  }
  function storedTargetFor(target, scope) {
    return scope === "project" ? path.relative(roots.project, target).split(path.sep).join("/") : target;
  }
  return { roots, discovery, targetFor, storedTargetFor };
}
