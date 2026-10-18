// Domain/application boundary: all I/O is supplied by ports.
const terminal = (status, reason) => ({ status, reason });
const text = value => typeof value === "string" && value.length > 0;

export function runtimeGrant(request, option) {
  return {
    workspace_id: request.workspace_id,
    option_id: option.id,
    source: option.source,
    fingerprint: option.fingerprint,
    action: request.action,
    scope: request.scope
  };
}

export function matchesRuntimeGrant(grant, request, option) {
  const expected = runtimeGrant(request, option);
  return Object.keys(expected).every(key => text(expected[key]) && grant?.[key] === expected[key]);
}

function validOption(option, request) {
  return option && ["id", "source", "fingerprint"].every(key => text(option[key])) &&
    option.action === request.action && option.scope === request.scope;
}

async function trace(ports, request, event, data = {}) {
  await ports.trace({ event, request_id: request.request_id, ...data });
}

async function resolve(request, ports) {
  if (!["request_id", "workspace_id", "action", "scope"].every(key => text(request[key]))) {
    return terminal("failed", "invalid_request");
  }
  if (await ports.workspaceValid(request) !== true) return terminal("failed", "workspace_mismatch");
  const instruction = await ports.lookupInstruction(request);
  await trace(ports, request, "instruction_resolved", { outcome: instruction?.status });
  if (instruction?.status !== "absent" && instruction?.status !== "matched") {
    return terminal("failed", "instruction_lookup_failed");
  }
  let option;
  let authority;
  if (instruction.status === "matched") {
    if (instruction.disposition === "deny") return terminal("denied", "alfred_denied");
    if (instruction.disposition !== "execute") return terminal("failed", "invalid_instruction");
    option = instruction.option;
    authority = "alfred";
  } else {
    const options = await ports.discoverOptions(request);
    await trace(ports, request, "external_options_discovered", { count: options?.length });
    if (!Array.isArray(options) || options.some(value => !value || !text(value.id)) ||
        new Set(options.map(value => value.id)).size !== options.length) {
      return terminal("failed", "invalid_discovery");
    }
    if (!options.length) return terminal("no_match", "no_external_option");
    const selected = request.option_id ?? await ports.selectOption(request, options);
    if (selected === null) return terminal("cancelled", "selection_cancelled");
    if (!text(selected)) return terminal("denied", "selection_required");
    option = options.find(value => value.id === selected);
    if (!option) return terminal("failed", "invalid_selection");
    authority = "external";
  }
  // Preparing reads/digests content only after selection; discovery is metadata-only.
  const permission = await ports.evaluatePolicy(request, option);
  await trace(ports, request, "permission_evaluated", { allowed: permission === true });
  if (permission !== true) return terminal("denied", "policy_denied");
  option = structuredClone(await ports.prepareOption(request, option));
  if (!validOption(option, request)) return terminal("failed", "invalid_option");
  const result = { status: "ready", authority, option, instruction_token: instruction.token };
  if (authority === "alfred") return result;
  const grants = await ports.loadGrants(request);
  if (!Array.isArray(grants)) return terminal("failed", "invalid_grants");
  const grant = grants.find(value => matchesRuntimeGrant(value, request, option));
  await trace(ports, request, grant ? "project_grant_reused" : "consent_required");
  return { ...result, status: grant ? "ready" : "approval_required" };
}

export async function resolveRuntimeRequest(request, ports) {
  try {
    return await resolve(request, ports);
  } catch {
    return terminal("failed", "resolution_failed");
  }
}

async function revalidate(request, resolution, ports) {
  if (await ports.workspaceValid(request) !== true) return false;
  const instruction = await ports.lookupInstruction(request);
  if (resolution.authority === "alfred") {
    if (instruction?.status !== "matched" || instruction.disposition !== "execute" ||
        instruction.token !== resolution.instruction_token) return false;
  } else if (instruction?.status !== "absent" || instruction.token !== resolution.instruction_token) return false;
  const options = resolution.authority === "alfred" ? [instruction.option] : await ports.discoverOptions(request);
  if (!Array.isArray(options)) return false;
  const candidates = options.filter(value => value?.id === resolution.option.id);
  if (candidates.length !== 1 || await ports.evaluatePolicy(request, candidates[0]) !== true) return false;
  const current = await ports.prepareOption(request, candidates[0]);
  return validOption(current, request) && matchesRuntimeGrant(runtimeGrant(request, resolution.option), request, current);
}

export async function runRuntimeRequest(request, ports) {
  // Capture request fields before awaiting any host port (a caller cannot widen scope).
  request = Object.freeze({ ...request });
  const stop = async (status, reason) => {
    await trace(ports, request, "runtime_request_stopped", { status, reason });
    return terminal(status, reason);
  };
  const check = async resolution => {
    const valid = await revalidate(request, resolution, ports);
    await trace(ports, request, "runtime_revalidated", { valid });
    return valid;
  };
  try {
    await trace(ports, request, "runtime_request_received");
    const resolution = await resolve(request, ports);
    if (!["ready", "approval_required"].includes(resolution.status)) {
      await trace(ports, request, "runtime_request_stopped", { status: resolution.status, reason: resolution.reason });
      return resolution;
    }
    let persist = false;
    if (resolution.status === "approval_required") {
      const binding = Object.freeze({ request_id: request.request_id, ...runtimeGrant(request, resolution.option) });
      const consent = await ports.consent(request, structuredClone(resolution.option), binding);
      if (!consent) return stop("denied", "consent_required");
      if (consent.choice === "cancel") {
        await trace(ports, request, "consent_cancelled");
        return stop("cancelled", "consent_cancelled");
      }
      if (!["once", "always"].includes(consent.choice) ||
          Object.keys(binding).some(key => consent.binding?.[key] !== binding[key])) {
        return stop("denied", "invalid_consent");
      }
      persist = consent.choice === "always";
      await trace(ports, request, "consent_received", { choice: consent.choice });
    }
    if (!await check(resolution)) return stop("failed", "revalidation_failed");
    if (persist) {
      await ports.saveGrant(request, runtimeGrant(request, resolution.option));
      if (!await check(resolution)) return stop("failed", "revalidation_failed");
    }
    await trace(ports, request, "execution_authorized", { authority: resolution.authority, option_id: resolution.option.id });
    // The execution port consumes this validated snapshot, never a new unchecked path read.
    const result = await ports.execute(request, resolution.option);
    if (result?.status === "failed") return stop("failed", "execution_failed");
    await trace(ports, request, "execution_completed", { authority: resolution.authority });
    return { status: "completed", authority: resolution.authority, result };
  } catch {
    try { await trace(ports, request, "runtime_request_failed"); } catch { /* fail closed even if tracing fails */ }
    return terminal("failed", "runtime_failure");
  }
}
