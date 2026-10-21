// Profiles for `alfred init`.
//
// A profile determines:
//   1. Which tenant kind to provision
//   2. Whether to write a .alfred/config.json (workspace binding)
//   3. What "next steps" to print
//
// The profile is selected via --profile=<coding|web|both> (default: coding).
// All profiles issue an API key. The kind is derived from the profile and the
// requested storage backend. Human agents (web profile) MUST use Postgres; we
// surface that requirement at validation time.
//
// This module is pure: it returns a plan object that the run() function then
// executes. It is also independently testable.

export const PROFILES = Object.freeze({
  coding: {
    name: "coding",
    description: "Coding agent in this directory (opencode, Codex, Pi, etc.).",
    tenant_kind: "coding_agent_only",
    storage_default: "sqlite",
    write_workspace_config: true,
    needs_db_path: true,
    next_steps_kind: "coding"
  },
  web: {
    name: "web",
    description: "Local browser and desktop clients using a Postgres tenant.",
    tenant_kind: "human_agent",
    storage_default: "postgres",
    write_workspace_config: false,
    needs_db_path: false,
    next_steps_kind: "web"
  },
  both: {
    name: "both",
    description: "Shared memory across coding agents in cwd and local browser clients.",
    tenant_kind: "hybrid_with_human",
    storage_default: "postgres",
    write_workspace_config: true,
    needs_db_path: false,
    next_steps_kind: "both"
  }
});

export function resolveProfile(name) {
  if (!name) return PROFILES.coding;
  if (PROFILES[name]) return PROFILES[name];
  return null;
}

export function listProfiles() {
  return Object.values(PROFILES);
}

export function buildInitPlan({
  profileName = "coding",
  storage = null,
  db_path = null,
  db_connection = null,
  name = null,
  cwd = process.cwd()
} = {}) {
  const profile = resolveProfile(profileName);
  if (!profile) {
    return { ok: false, error: `Unknown profile '${profileName}'. Available: ${Object.keys(PROFILES).join(", ")}` };
  }

  // Resolve backend. Web/both require Postgres (per hosting policy).
  const resolved_storage = storage || profile.storage_default;
  if (profile.tenant_kind !== "coding_agent_only" && resolved_storage !== "postgres") {
    return {
      ok: false,
      error: `Profile '${profileName}' requires Postgres (storage backend 'postgres'). Use --backend=postgres or --db-connection.`
    };
  }
  if (profile.tenant_kind === "coding_agent_only" && resolved_storage === "postgres" && !db_connection) {
    return {
      ok: false,
      error: `Profile '${profileName}' with --backend=postgres requires --db-connection <url>.`
    };
  }

  // Derive a tenant display name.
  const display_name = name || `alfred-${profileName}-${new Date().toISOString().slice(0, 10)}`;

  // Compute defaults for db_path / db_connection.
  const default_db_path = db_path || `${process.env.HOME || "/tmp"}/.alfred/tenants/${display_name}.sqlite`;
  const default_db_connection = db_connection || `postgres://localhost/${display_name.replace(/[^a-z0-9_-]/gi, "_")}`;

  // Validate the resolved path/connection.
  const final_db_path = resolved_storage === "sqlite" ? default_db_path : null;
  const final_db_connection = resolved_storage === "postgres" ? default_db_connection : null;

  if (resolved_storage === "sqlite" && !final_db_path) {
    return { ok: false, error: "Internal: db_path was null after defaults." };
  }
  if (resolved_storage === "postgres" && !final_db_connection) {
    return { ok: false, error: "Internal: db_connection was null after defaults." };
  }

  return {
    ok: true,
    plan: {
      profile: profileName,
      profile_description: profile.description,
      tenant_kind: profile.tenant_kind,
      storage: resolved_storage,
      db_path: final_db_path,
      db_connection: final_db_connection,
      display_name,
      cwd,
      write_workspace_config: profile.write_workspace_config,
      next_steps_kind: profile.next_steps_kind
    }
  };
}

export function nextStepsFor(kind, { tenant_id, api_key, registry_path, server_base_url = "http://127.0.0.1:3000" } = {}) {
  if (!["coding", "web", "both"].includes(kind)) return ["# No next steps available for kind=" + kind];
  return [
    kind === "coding" ? "# Coding agent setup (opencode / Codex / Pi / Copilot)" : kind === "both" ? "# Both: coding + web (local clients)" : "# Local browser and desktop setup",
    "",
    "Save your API key now: " + (api_key || "alk_..."),
    "Start the local server in another terminal:",
    "  ALFRED_MEMORY_REQUIRE_AUTH=true alfred serve",
    "Open " + server_base_url + "/console/ and unlock it with your API key.",
    "Keep the local server running while using Memory.",
    "",
    ...(kind !== "web" ? ["Your config is in <cwd>/.alfred/config.json."] : []),
    "For local coding clients, Claude Desktop, or the Gemini bridge, set:",
    "  ALFRED_MEMORY_BASE_URL=" + server_base_url,
    "  ALFRED_MEMORY_API_KEY=" + (api_key || "alk_..."),
    "Cloud ChatGPT Actions and Google AI Studio cannot reach this loopback service.",
    "Postgres storage does not enable remote access to the server.",
    "",
    "Test it:",
    "  curl -H 'Authorization: Bearer " + (api_key || "alk_...") + "' " + server_base_url + "/memories?limit=5",
    "Tenant: " + (tenant_id || "..."),
    "Registry: " + (registry_path || "~/.alfred/registry.sqlite")
  ];
}
