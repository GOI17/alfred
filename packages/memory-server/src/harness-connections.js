const MEMORY_BEHAVIOR = Object.freeze([
  "Search relevant shared memory before work when prior context may matter.",
  "Save durable decisions, corrections, preferences, facts, and workflows.",
  "Include a concise reason explaining why the memory will help future work.",
  "Never save private chain-of-thought, secrets, or temporary conversation."
]);

const CONNECTIONS = Object.freeze({
  chatgpt: Object.freeze({
    harness: "chatgpt",
    actor: "ChatGPT",
    name: "ChatGPT",
    transport: "openapi",
    publicEndpointRequired: true,
    auth: "Bearer API key",
    schemaPath: "packages/chatgpt-adapter/openapi.json"
  }),
  gemini: Object.freeze({
    harness: "gemini",
    actor: "Gemini",
    name: "Gemini",
    transport: "openapi",
    publicEndpointRequired: true,
    auth: "x-api-key header",
    schemaPath: "packages/gemini-adapter/openapi.json"
  }),
  codex: Object.freeze({
    harness: "codex",
    actor: "Codex",
    name: "Codex",
    transport: "mcp",
    publicEndpointRequired: false,
    auth: "MCP environment",
    schemaPath: null
  }),
  opencode: Object.freeze({
    harness: "opencode",
    actor: "OpenCode",
    name: "OpenCode",
    transport: "mcp",
    publicEndpointRequired: false,
    auth: "MCP environment",
    schemaPath: null
  })
});

export function getHarnessConnection(harness) {
  if (typeof harness !== "string") return null;
  return CONNECTIONS[harness.trim().toLowerCase()] ?? null;
}

export function listHarnessConnections() {
  return Object.values(CONNECTIONS).map((item) => ({ ...item, behavior: [...MEMORY_BEHAVIOR] }));
}

export function buildHarnessConnectionPreview(harness, {
  baseUrl = "http://127.0.0.1:3000",
  apiKey = "<ALFRED_API_KEY>",
  mcpCliPath = "packages/memory-mcp/src/cli.js"
} = {}) {
  const definition = getHarnessConnection(harness);
  if (!definition) {
    const error = new Error(`Unsupported harness '${harness}'.`);
    error.code = "validation_error";
    error.status = 400;
    throw error;
  }

  const normalizedBaseUrl = String(baseUrl || "http://127.0.0.1:3000").replace(/\/$/, "");
  const common = {
    ...definition,
    base_url: normalizedBaseUrl,
    behavior: [...MEMORY_BEHAVIOR],
    agent_instructions: MEMORY_BEHAVIOR.join(" "),
    consequences: [
      `Creates one revocable API key bound to ${definition.name}.`,
      "Allows this agent to read and write memories in the current tenant.",
      "Server-enforced actor identity is added to every new memory."
    ],
    provider_calls: 0,
    writes_before_approval: 0
  };

  if (definition.transport === "mcp") {
    const environment = {
      ALFRED_MEMORY_BASE_URL: normalizedBaseUrl,
      ALFRED_MEMORY_API_KEY: apiKey
    };
    const configuration = definition.harness === "codex"
      ? {
          format: "toml",
          target: "~/.codex/config.toml or .codex/config.toml",
          content: [
            "[mcp_servers.alfred-memory]",
            'command = "node"',
            `args = [${JSON.stringify(mcpCliPath)}]`,
            'default_tools_approval_mode = "writes"',
            "",
            "[mcp_servers.alfred-memory.env]",
            `ALFRED_MEMORY_BASE_URL = ${JSON.stringify(normalizedBaseUrl)}`,
            `ALFRED_MEMORY_API_KEY = ${JSON.stringify(apiKey)}`
          ].join("\n")
        }
      : {
          format: "json",
          target: "opencode.json or opencode.jsonc (OpenCode 1.x)",
          content: JSON.stringify({
            $schema: "https://opencode.ai/config.json",
            mcp: {
              "alfred-memory": {
                type: "local",
                command: ["node", mcpCliPath],
                enabled: true,
                environment
              }
            }
          }, null, 2),
          alternatives: [{
            name: "OpenCode V2",
            target: "opencode.json or opencode.jsonc",
            content: JSON.stringify({
              $schema: "https://opencode.ai/config.json",
              mcp: {
                servers: {
                  "alfred-memory": {
                    type: "local",
                    command: ["node", mcpCliPath],
                    environment
                  }
                }
              }
            }, null, 2)
          }]
        };
    return {
      ...common,
      configuration,
      steps: [
        ...(definition.harness === "opencode" ? ["Use the OpenCode 1.x block by default, or the labeled V2 alternative when running OpenCode V2."] : []),
        `Add the generated MCP server to ${definition.name}. The command points to Alfred's installed MCP adapter.`,
        `Restart ${definition.name} so it discovers the memory tools.`,
        "Ask the agent to search shared memory, then save a durable test decision."
      ],
      warning: null
    };
  }

  const isPublicHttps = normalizedBaseUrl.startsWith("https://");
  return {
    ...common,
    configuration: {
      schema: definition.schemaPath,
      server_url: normalizedBaseUrl,
      authentication: definition.auth,
      api_key: apiKey,
      agent_instructions: MEMORY_BEHAVIOR.join(" ")
    },
    steps: [
      `Import ${definition.schemaPath} into ${definition.name}.`,
      `Set the action server URL to ${normalizedBaseUrl}.`,
      `Configure ${definition.auth} with the generated key.`,
      `Add agent_instructions to ${definition.name}'s instructions so memory is searched and saved consistently.`,
      "Ask the agent to search shared memory, then save a durable test decision."
    ],
    warning: isPublicHttps
      ? null
      : `${definition.name} runs in the cloud and cannot reach localhost. Publish Alfred behind HTTPS before completing this connection.`
  };
}

export function connectionStatusFor(definition, keys) {
  const key = keys
    .filter((item) => !item.revoked_at && item.harness === definition.harness)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0] ?? null;
  if (!key) return { status: "not_connected", key: null };
  return { status: key.last_used_at ? "connected" : "awaiting_first_use", key };
}

export const harnessConnectionIds = Object.freeze(Object.keys(CONNECTIONS));
