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
    description: "Web-only usage from ChatGPT, Claude, Gemini.",
    tenant_kind: "human_agent",
    storage_default: "postgres",
    write_workspace_config: false,
    needs_db_path: false,
    next_steps_kind: "web"
  },
  both: {
    name: "both",
    description: "Shared memory across coding agents in cwd AND web clients.",
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

export function nextStepsFor(kind, { tenant_id, workspace_id, api_key, registry_path, server_base_url = "http://localhost:3000" } = {}) {
  // Each line is a human-readable step. Lines starting with "#" are headers.
  if (kind === "coding") {
    return [
      "# Coding agent setup (opencode / Codex / Pi / Copilot)",
      "",
      "Your config is already in <cwd>/.alfred/config.json. The agent reads it.",
      "",
      "If the agent supports env-var override, set:",
      "  ALFRED_MEMORY_BASE_URL=" + server_base_url,
      "  ALFRED_MEMORY_API_KEY=" + (api_key || "alk_..."),
      "",
      "Test it:",
      "  curl -H 'Authorization: Bearer " + (api_key || "alk_...") + "' " + server_base_url + "/memories?limit=5"
    ];
  }
  if (kind === "web") {
    return [
      "# Web agent setup",
      "",
      "Your API key is the credential for ALL your web clients.",
      "Save it now: " + (api_key || "alk_..."),
      "",
      "## ChatGPT (Plus/Pro)",
      "1. Run the bridge:",
      "   ALFRED_MEMORY_BASE_URL=" + server_base_url + " ALFRED_MEMORY_API_KEY=" + (api_key || "alk_...") + " \\",
      "     node packages/chatgpt-adapter/src/bridge.mjs &",
      "2. In ChatGPT: My GPTs -> Create -> Configure -> Actions -> Import OpenAPI.",
      "3. Upload packages/chatgpt-adapter/openapi.json.",
      "4. Auth: API Key, Bearer, value=" + (api_key || "alk_..."),
      "",
      "## Claude (Desktop)",
      "1. Edit ~/Library/Application Support/Claude/claude_desktop_config.json:",
      "   { \"mcpServers\": { \"alfred-memory\": {",
      "     \"command\": \"node\",",
      "     \"args\": [\"<abs path>/packages/anthropic-adapter/bin/alfred-mcp.mjs\"],",
      "     \"env\": { \"ALFRED_MEMORY_API_KEY\": \"" + (api_key || "alk_...") + "\",",
      "               \"ALFRED_MEMORY_BASE_URL\": \"" + server_base_url + "\" } } } }",
      "2. Restart Claude Desktop.",
      "",
      "## Google Gemini / AI Studio",
      "1. Run the bridge:",
      "   ALFRED_MEMORY_BASE_URL=" + server_base_url + " ALFRED_MEMORY_API_KEY=" + (api_key || "alk_...") + " \\",
      "     node packages/gemini-adapter/bin/bridge.mjs &",
      "2. In AI Studio: Tools -> Extensions -> Create Extension.",
      "3. Upload packages/gemini-adapter/openapi.json.",
      "4. Auth: API Key, header x-api-key, value=" + (api_key || "alk_..."),
      "",
      "Tenant: " + (tenant_id || "..."),
      "Registry: " + (registry_path || "~/.alfred/registry.sqlite")
    ];
  }
  if (kind === "both") {
    return [
      "# Both: coding + web",
      "",
      "Coding agent config is in <cwd>/.alfred/config.json.",
      "API key works for any agent. Save it: " + (api_key || "alk_..."),
      "",
      "For web setup, see:",
      "  alfred adapters instructions chatgpt-custom-gpt",
      "  alfred adapters instructions claude-desktop",
      "  alfred adapters instructions google-ai-studio"
    ];
  }
  return ["# No next steps available for kind=" + kind];
}
