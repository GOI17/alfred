---
id: execution/model-assignment-per-agent/design
description: OpenCode model inheritance design for issue 173
owner: core
phase: design
---

# model-assignment-per-agent Design

Issue: [#173](https://github.com/GOI17/alfred/issues/173) — emit resolved OpenCode agent models while preserving active-model inheritance.

The decision in **Section 2** is authoritative for issue #173 and supersedes any conflicting OpenCode notes retained from the broader model-assignment design.

Verification follow-up: the user authorized a repair limited to
`packages/memory-openapi/test/openapi.test.js` so its YAML subset parser consumes
the existing single-paragraph folded descriptions. This adds regression coverage
without changing the published OpenAPI contract or package dependencies.

## 1. Technical Approach

Keep the hierarchical, user-owned model resolver harness-agnostic. For issue #173, the OpenCode adapter consumes its output and translates only a resolved `primary` into the generated agent markdown; no core, profile, installer, Codex, baseline, or harness-config work is in scope.

Broader resolution context, unchanged by #173:

- Agent-specific user configuration may specialize a model assignment.
- `profile-manager` may overlay models per profile.
- `~/.alfred/models.json` may provide agent or `*` defaults.
- System and per-agent fallback chains remain runtime inputs.

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
| Generated `.opencode/agents/<id>.md` is the single native OpenCode agent definition. | Avoids two competing configuration sources. |
| Emit `model: "<resolved-primary>"` only when resolved; otherwise omit the key. | Quoting is YAML-safe, while omission preserves OpenCode active-model inheritance. |
| `opencode.json` has no custom top-level `model_assignment` and no parallel agent bindings. | OpenCode does not consume that custom shape. |
| Fallbacks remain an Alfred runtime concern. | The adapter must not claim OpenCode natively enforces Alfred fallback chains. |

## 3. Data Flow

```
user-owned runtime configuration
              |
              v
Alfred resolver -> { agent_id, primary?, fallbacks, provider_calls: 0 }
              |                         |
              |                         +-> Alfred runtime retry/fallback
              v
OpenCode adapter -> .opencode/agents/<id>.md
                    - resolved: quoted YAML model
                    - unresolved: model omitted

opencode.json -> consumed base settings only; no agent model binding
```

## 4. File Changes

Only the OpenCode runtime and test rows are implementation scope for #173. Other rows preserve the broader model-assignment context and are not tasks for this issue.

| File | Change |
|---|---|
| `packages/core/src/model-assignment.js` | New resolver: `resolveModelAssignment`, `resolveFallbacks`, `resolveTemporaryModel`, `traceModelResolution`. |
| `packages/core/src/index.js` | Re-export new model assignment functions; wire `loadArchitectureKernel` to read `.ai/policies/model-assignment.example.json`. |
| `packages/profile-manager/src/index.js` | Add `resolveProfileModels({ repoPath, profile, agent })` that reads `profiles/{profile}/{agent}/models.jsonc` and merges with global defaults. |
| `packages/opencode-adapter/src/runtime.js` | Pass each resolved primary to its generated agent markdown, emit it as quoted YAML, omit it when unresolved, and remove custom model assignment output from `opencode.json`. |
| `packages/opencode-adapter/test/runtime.test.mjs` | Cover resolved and unresolved markdown, absence of JSON bindings, zero provider calls, and model-agnostic source specs. |
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

### OpenCode native artifact contract (#173)

- Resolved: generated `.opencode/agents/<id>.md` contains `model: "provider/model"` in frontmatter.
- Unresolved: generated markdown has no `model` key, so OpenCode inherits the active model.
- `opencode.json` contains neither `model_assignment` nor a parallel JSON agent binding.
- `fallbacks` may remain in Alfred's resolved runtime data but are not serialized or described as OpenCode-native enforcement.

## 6. Testing Strategy

| Test | Scope |
|---|---|
| Unit: global default via `*` | `packages/core/tests/model-assignment.test.js` |
| Unit: agent-specific override | same |
| Unit: profile overlay precedence | `packages/profile-manager/tests/model-assignment.test.js` |
| Unit: resolved primary is quoted in generated agent markdown | `packages/opencode-adapter/test/runtime.test.mjs` |
| Unit: unresolved primary omits markdown `model` | same |
| Unit: `opencode.json` contains no custom or parallel model binding | same |
| Unit: TemporaryAgent inheritance | `packages/core/tests/model-assignment.test.js` |
| Integration: resolve → execute with mock provider gateway | `packages/core/tests/integration/model-assignment-integration.test.js` |
| Regression: model names never appear in `.ai/agents/*.md` | `packages/opencode-adapter/test/runtime.test.mjs` |
| Trace: every resolution emits `model_assignment_resolved` | trace assertions in unit tests |

No provider calls are permitted in deterministic resolution tests.

## 7. Installer Integration (Broader Context; Out of Scope for #173)

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

## 8. Migration / Rollout (Broader Context; #173 Is Step 5 Only)

1. Ship resolver in `packages/core` with no breaking change to existing `loadArchitectureKernel` consumers.
2. Add model-assignment step to `scripts/shell/install.sh` suite TUI.
3. Add reconfiguration step to `scripts/shell/update.sh`.
4. Update `packages/profile-manager` to detect local models and write profile-level model overlays.
5. For #173, update `opencode-adapter` to emit resolved primary models only in generated agent markdown and remove `opencode.json.model_assignment`.
6. Backfill baseline in `.ai/evals/baselines/model-assignment.json`.
7. Do not represent Alfred fallback chains as OpenCode-native capability; they remain runtime-managed.

## 9. Open Questions (Resolved)

| Question | Decision |
|---|---|
| Should the harness override layer be fully adapter-driven, or should core define a portable `harness_model_binding` schema? | Core defines a portable `harness_model_binding` shape; each adapter maps it to its own config format. |
| How are model names redacted in trace events when the harness marks them private? | Adapters may pass a `redact_model_names` flag; the resolver replaces model IDs with hashes in trace events when enabled. |
| Should `models.json` support provider-qualified IDs (e.g. `anthropic/claude-opus-4`) or stay provider-agnostic? | Support provider-qualified IDs. They are optional but recommended for clarity. |
| Do we validate `models.json` on `alfred init` or lazily on first provider request? | Validate at `alfred init` and on `alfred update` with a lightweight local JSON schema. |
| Where does OpenCode receive an agent's resolved primary? | The generated agent markdown frontmatter, as the single native agent definition. |
| What happens when no primary resolves? | Omit `model`; OpenCode inherits the active model. |
