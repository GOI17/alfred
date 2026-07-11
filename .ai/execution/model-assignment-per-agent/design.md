# model-assignment-per-agent Design

Issue: #85 — Allow users to assign a specific model per agent while keeping agent specs model-agnostic.

## 1. Technical Approach

Add a hierarchical, user-owned model resolver in `packages/core`. The resolver never reads harness-specific internals; adapters read the resolved binding and translate it to their own config shape.

Resolution order:

1. **Harness override** — if the current harness adapter exposes per-agent model binding (e.g. opencode exposes `models` per agent), use it.
2. **Profile override** — `profile-manager` overlays `models` per profile.
3. **Global default** — `~/.alfred/models.json` maps agent ids or `*` to `{ primary, fallbacks }`.
4. **System-wide fallback chain** — configured in `~/.alfred/models.json` under `fallbacks`.

TemporaryAgent inherits its creator's resolved model unless a `temporary` or `temporary:*` entry exists.

## 2. Architecture Decisions

| Decision | Rationale |
|---|---|
| Core owns the resolution policy shape, not the harness format. | Keeps core harness-agnostic; adapters translate. |
| Agent specs remain model-agnostic. | Preserves the existing policy; model IDs never leak into `.ai/agents/`. |
| Global config lives in `~/.alfred/models.json`. | Separate from per-project source of truth; matches memory registry layout. |
| Profile manager extends with `models` overlay. | Reuses existing JSONC/merge infrastructure without touching harness directories. |
| TemporaryAgent inherits creator model by default. | Avoids surprising behavior; explicit `temporary` entry allows override. |
| Fallback chain is per-agent-overrideable. | Lets power users keep a global chain while specializing individual agents. |
| All resolution emits trace events. | Satisfies runtime hardening contract trace requirements. |

## 3. Data Flow

```
+-------------------+     +-------------------------+     +------------------+
| harness-specific  |---->|  adapter.translateModel |---->|                  |
|   config          |     |  (opencode, codex, ...) |     |                  |
+-------------------+     +-------------------------+     |  core.resolveModel |
                                                          |    assignment      |
+-------------------+     +-------------------------+     |                  |
| profile-manager   |---->|   models overlay        |---->|                  |
|   profiles/*      |     |   (deepMerge)           |     |                  |
+-------------------+     +-------------------------+     +---------+--------+
                                                                   |
+-------------------+     +-------------------------+              |
| ~/.alfred/models  |---->| global default +        |------------->|
|    .json          |     | fallbacks               |              |
+-------------------+     +-------------------------+              v
                                                          +------------------+
                                                          | model execution  |
                                                          | (primary, retry,  |
                                                          |  fallback chain) |
                                                          +------------------+
```

## 4. File Changes

| File | Change |
|---|---|
| `packages/core/src/model-assignment.js` | New resolver: `resolveModelAssignment`, `resolveFallbacks`, `resolveTemporaryModel`, `traceModelResolution`. |
| `packages/core/src/index.js` | Re-export new model assignment functions; wire `loadArchitectureKernel` to read `.ai/policies/model-assignment.example.json`. |
| `packages/profile-manager/src/index.js` | Add `resolveProfileModels({ repoPath, profile, agent })` that reads `profiles/{profile}/{agent}/models.jsonc` and merges with global defaults. |
| `packages/opencode-adapter/src/runtime.js` | Extend `buildOpencodeJsonPreview` to include per-agent `models` from resolved binding; keep `model: "user-owned-runtime-configuration"` in generated agent frontmatter. |
| `packages/codex-adapter/src/runtime.js` | (if exists) Consume resolver and emit model binding in generated Codex config preview. |
| `.ai/policies/model-assignment.example.json` | Schema example for global `models.json` with `*`, agent ids, and `temporary:*`. |
| `.ai/evals/baselines/model-assignment.json` | Baseline asserting zero provider calls and correct resolution order. |

## 5. Interfaces / Contracts

### `resolveModelAssignment(input)`

```js
{
  agentId: string,              // required
  creatorAgentId?: string,      // for temporary agent inheritance
  harness?: string,             // e.g. "opencode"
  harnessModelBinding?: object, // adapter-specific, validated by adapter
  profileManager?: object,      // profile-manager instance
  globalConfigPath?: string     // default: ~/.alfred/models.json
}
```

Returns:

```js
{
  agent_id: string,
  primary: string,
  fallbacks: string[],
  sources: string[],      // which layers contributed
  trace_event: object,
  provider_calls: 0
}
```

### `models.json` schema

```json
{
  "*": { "primary": "claude-sonnet-4", "fallbacks": ["gpt-4.1", "local-llama"] },
  "orchestrator": { "primary": "claude-opus-4" },
  "developer": { "fallbacks": ["claude-sonnet-4", "gpt-4.1"] },
  "temporary": { "primary": "claude-haiku" },
  "temporary:*": { "primary": "claude-sonnet-4" },
  "fallbacks": ["local-llama"]
}
```

Resolution rules:
- `primary` and `fallbacks` deep-merge by source order.
- Missing `primary` falls back to `*` primary, then system fallback chain.
- `temporary:*` overrides `temporary`; both override `*`.

## 6. Testing Strategy

| Test | Scope |
|---|---|
| Unit: global default via `*` | `packages/core/tests/model-assignment.test.js` |
| Unit: agent-specific override | same |
| Unit: profile overlay precedence | `packages/profile-manager/tests/model-assignment.test.js` |
| Unit: harness override precedence | `packages/opencode-adapter/tests/runtime.test.js` |
| Unit: TemporaryAgent inheritance | `packages/core/tests/model-assignment.test.js` |
| Integration: resolve → execute with mock provider gateway | `packages/core/tests/integration/model-assignment-integration.test.js` |
| Regression: model names never appear in `.ai/agents/*.md` | eval script scanning agent specs |
| Trace: every resolution emits `model_assignment_resolved` | trace assertions in unit tests |

No provider calls are permitted in deterministic resolution tests.

## 7. Installer Integration

The Alfred installer becomes the primary way a user creates the initial model assignment. This applies to `alfred init` and `alfred update`.

### Installer flow

1. **Detect local capabilities** — inspect environment for available providers/models:
   - `OPENAI_API_KEY` present → OpenAI models available.
   - `OLLAMA_HOST` or local Ollama socket → local models available.
   - GitHub Copilot token → Copilot models available.
   - Anthropic/Gemini keys → corresponding providers available.
2. **Propose smart defaults**:
   - Global wildcard `*` → cheapest/best-available model.
   - `orchestrator` → capable planning model.
   - `developer` → strong coding model.
   - `temporary` → inherits creator by default; optional override.
   - Global fallback chain built from detected providers in order: local → cheap cloud → premium cloud.
3. **User choices**:
   - Accept all defaults.
   - Edit the global wildcard and fallback chain.
   - Customize per agent (orchestrator, developer, temporary).
   - Skip model assignment entirely (resolver falls back to empty config and harness defaults).
4. **Write configuration**:
   - `~/.alfred/models.json` with the global wildcard, agent overrides, and fallbacks.
   - If a profile is active, also write `~/.alfred/profiles/{profile}/models.jsonc` (or `profiles.local/{profile}/`) with profile-specific overrides.
5. **Trace events** emitted:
   - `model_assignment_configured`
   - `provider_request_avoided`

### Installer scripts affected

- `scripts/shell/install.sh` — add model-assignment step to the suite TUI.
- `scripts/shell/update.sh` — re-offer model assignment when new providers are detected or when requested by the user.
- `packages/profile-manager/src/index.js` — expose `detectMachineModels()` helper for local capability detection.

### Validation

- Installer preview must show the proposed `~/.alfred/models.json` before writing.
- No live harness config is written during model assignment.
- `provider_calls` remain 0; detection is local.

## 8. Migration / Rollout

1. Ship resolver in `packages/core` with no breaking change to existing `loadArchitectureKernel` consumers.
2. Add model-assignment step to `scripts/shell/install.sh` suite TUI.
3. Add reconfiguration step to `scripts/shell/update.sh`.
4. Update `packages/profile-manager` to detect local models and write profile-level model overlays.
5. Update `opencode-adapter` to consume resolver and expose per-agent `models` in `opencode.json` preview.
6. Backfill baseline in `.ai/evals/baselines/model-assignment.json`.
7. Mark capability in compatibility matrix: `model_assignment: "native"`.

## 9. Open Questions (Resolved)

| Question | Decision |
|---|---|
| Should the harness override layer be fully adapter-driven, or should core define a portable `harness_model_binding` schema? | Core defines a portable `harness_model_binding` shape; each adapter maps it to its own config format. |
| How are model names redacted in trace events when the harness marks them private? | Adapters may pass a `redact_model_names` flag; the resolver replaces model IDs with hashes in trace events when enabled. |
| Should `models.json` support provider-qualified IDs (e.g. `anthropic/claude-opus-4`) or stay provider-agnostic? | Support provider-qualified IDs. They are optional but recommended for clarity. |
| Do we validate `models.json` on `alfred init` or lazily on first provider request? | Validate at `alfred init` and on `alfred update` with a lightweight local JSON schema. |
