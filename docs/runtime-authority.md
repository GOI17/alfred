# Managed runtime authority

This guide describes the first implementation slice of issue #217. It does not imply that the released Homebrew package already includes these commands. Use a build containing `alfred runtime`; the first managed CLI slice is verified after rebasing onto main.

## Install once, initialize each project

Install Alfred using the [installation instructions](../README.md#human-installation). The shared installation supplies the executable; project initialization creates runtime state, not another Alfred installation. `alfred runtime init` is separate from Memory `alfred init` and does not provision a tenant or API key.

From each project directory:

```sh
alfred runtime init --instructions /absolute/path/to/shared/instructions.json
alfred runtime status
```

The manifest is required and contains Alfred's applicable instruction rules. Runtime state lives in `.alfred/runtime/project.json`; persistent approvals live in `.alfred/runtime/grants.json`. Each binds to the canonical workspace path. From an ordinary subdirectory, `run` and `status` find the nearest initialized ancestor. Discovery stops at a Git repository boundary (`.git` directory or worktree file): an uninitialized nested repository cannot inherit the parent workspace. Explicit initialization in a nested directory establishes an independent workspace. Sibling worktrees and copies of the project do not inherit approvals. Keep this local state out of shared templates and version control.

## What happens on a request

Alfred reads its instructions first on every managed request. A matching rule decides the route; a deny rule stops the request. Only a successful lookup with no applicable instruction enables discovery in the optional global catalog `~/.alfred/runtime/options.json`.

For a selected global option without a current grant, the interactive choices are:

- **Permitir:** authorize this request and exact option once; save no approval.
- **Permitir siempre:** save an approval for this project, option, content and exact action/scope.
- **Cancelar:** stop without executing or trying an alternative.

Global discovery inspects option metadata, not the candidate text. Consent is bound to the declared digest; after authorization Alfred reads and verifies the content before returning it. A digest mismatch returns no content and stops the request.

Existing grants do not skip Alfred-first resolution or permission checks. Changed source content or contract invalidates approval. An error, denial or cancellation never enables fallback. In a noninteractive session, missing required consent stops execution.

## Practical example: load a shared TypeScript playbook

The supported first contract is `read-text-v1`: it reads authorized local text and returns the validated snapshot. It does not execute instructions in that text. The action and scope below are exact matching labels, not shell commands.

Prepare a shared text file, for example `/absolute/path/to/shared/typescript.md`, with your reviewed TypeScript guidance. Prepare an Alfred manifest with no applicable rules so this example can exercise global discovery:

```json
{"version":1,"instructions":[],"options":[]}
```

Save it as `/absolute/path/to/shared/instructions.json`. A missing or malformed manifest is an error, not an empty instruction set.

Generate an option with the canonical source path and raw lowercase SHA-256 digest using Node, already required by Alfred. This prints JSON for review and does not overwrite a catalog:

```sh
node --input-type=module - /absolute/path/to/shared/typescript.md <<'JS'
import { realpathSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = realpathSync(process.argv[2]);
const digest = createHash('sha256').update(readFileSync(source)).digest('hex');
console.log(JSON.stringify({
  id: 'global-ts', source, contract: 'read-text-v1',
  action: 'load-instructions', scope: 'typescript', digest
}, null, 2));
JS
```

The global catalog has this shape. Replace its example option with the complete object printed above; the placeholder below is not a valid digest:

```json
{
  "version": 1,
  "options": [{
    "id": "global-ts",
    "source": "/absolute/path/to/shared/typescript.md",
    "contract": "read-text-v1",
    "action": "load-instructions",
    "scope": "typescript",
    "digest": "REPLACE_WITH_CONTENT_DIGEST"
  }]
}
```

Review and merge the option into `~/.alfred/runtime/options.json`; preserve existing options. Then, from an initialized project, request it explicitly:

```sh
alfred runtime run --action load-instructions --scope typescript --option global-ts
```

Reply with exactly `Permitir`, `Permitir siempre`, or `Cancelar` when prompted. Successful execution returns JSON containing the reviewed playbook content in `result.content`, preserving a UTF-8 BOM when present. Option metadata and prompts use stderr; request traces are stored locally. Choosing Permitir siempre allows a subsequent identical request in this project without repeating that option's consent, provided content, contract, scope and policies still match.

To route the same action directly through Alfred instead, put the option in the manifest's `options` and add this rule to its `instructions`:

```json
{
  "id": "typescript-guidance",
  "action": "load-instructions",
  "scope": "typescript",
  "disposition": "execute",
  "option": "global-ts"
}
```

Global discovery must not run for that matching rule. A rule with `disposition: "deny"` and no `option` stops the request; it does not offer the global alternative.

## Command options

`init` requires `--instructions` with an absolute manifest path. `init`, `run` and `status` accept `--cwd` to select the workspace explicitly. `run` requires `--action` and `--scope`; `--option` selects a specific option. `--non-interactive` disables prompts. There is no `--catalog` override in this slice.

If multiple candidates require selection, use the displayed numeric index or cancel. This selection is separate from consent. Noninteractive operation still requires a valid existing grant wherever consent is required.

## Results and traces

The CLI writes JSON to stdout: successful reads expose `result.content`; failures report `status` and `reason`. Option metadata and prompts go to stderr. Local request traces live at `.alfred/runtime/trace.jsonl` and correlate events through `request_id`. Their metadata allowlist excludes source content, request input and source paths. The interactive option display still identifies the selected source so you can review consent.

## Future skills

Concrete actions will be implemented as Alfred skills. Opening a URL is an illustration of the resolution flow, not a required feature or built-in URL contract in #217. The runtime provides generic skill resolution, authorization and invocation; adding specific skills is separate future work.

## Current boundary

The guarantee applies to requests through the managed CLI. This slice reads text only. It does not open URLs, run shell commands, enforce arbitrary host tools, apply a playbook's instructions, or intercept every native Codex/Pi/OpenCode/Copilot request. Host bridges and durable execution loops are later stages. Host system instructions, sandbox and approval controls remain in force.

See [ADR 010](architecture/010-runtime-authority.md) and the [implementation contract](../.ai/execution/alfred-runtime-authority.md) for the staged scope and remaining acceptance conditions.

## Guide validation

Validated against the worktree CLI: actual `runtime --help`, initialization and status, the global playbook example with interactive `Permitir`, noninteractive rejection without consent, exact content including BOM, and absence of a persisted Once grant. Fixtures used temporary projects and a temporary home. These checks do not establish completion of the full issue or replace the regression suite.

Final validation after rebase onto main: `npm test` and `npm run check` pass, including the actual installer PTY, all 19 release gates and release automation. The existing eval baseline comparison passes with zero regressions and no baseline updates. A real-terminal Always flow also verified persistence in project A, isolation from project B, and precedence of a later Alfred deny over a stored grant. The reviewer reported no remaining findings. Native host bridges and generic skill invocation remain outside this slice; the broader #217 objective is not complete.

## Task policy refinement (core decisions verified)

Alfred policy now requires delegation for every substantive task, including read-only analysis. Only a quick single question already answerable without analysis, code, commands, tools or other action may be answered directly. No unnecessary tool calls are permitted; required orchestration and action/verification tools remain allowed.

Each new independent substantive task gets a native Git worktree. Continuations and specialists reuse that task's verified worktree, with independent disjoint work parallelized and dependencies sequenced. The quick plain-answer exception uses no worktree: this explicitly reconciles the every-task and no-tools rules, rather than exempting all read-only tasks. At task completion Alfred asks whether to remove the worktree and does not delete it without your choice or discard changes or branches.

The R7 core policy decisions pass full tests/checks/evals and 24 independent policy tests. The existing read-text CLI does not itself demonstrate native host interception, automatic delegation or a completed Git worktree lifecycle. Native lifecycle integration and the full issue remain pending.
