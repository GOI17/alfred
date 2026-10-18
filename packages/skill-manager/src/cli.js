import os from "node:os";
import { createSkillManager, searchSkills, validateSkillDirectory } from "./index.js";
import { fail } from "./model.js";

const help = `Usage: alfred skills <list|info|add|install|update|remove|search|validate> [options]

  list                         Inspect skill directories and receipts offline
  info <name>                  Show one installation and its provenance
  install <directory|repo-url>  Preview one local or public GitHub skill
  add <directory|repo-url>      Exact alias of install
  update <name>                Preview an update from the recorded source
  remove <name>                Preview removal of one managed, intact skill
  search <query>               Query the public skills.sh catalog (not installed inventory)
  validate <directory>         Validate a local draft without installing it

Options:
  --cwd <path>                 Selected project/worktree (default: current directory)
  --scope project|global       Read both by default; mutations default to project
  --harness codex|opencode     Select a native destination; required if ambiguous
  --json                       Machine-readable result, including trace and coverage
  --skill <relative-directory> Select one GitHub skill directory (. means repo root)
  --name <declared-name>        Resolve a unique GitHub skill name; exclusive with --skill
  --ref <branch|tag|commit>     GitHub install/update ref (install default: HEAD)
  --limit <1..20>               Search result limit (default: 10)
  --apply                      Explicitly authorize the selected mutation
  --dry-run                    Preview only, including when --apply is supplied
  --expected-digest <sha256:..> Apply only the reviewed content (remove: installed digest)
  --expected-commit <40-hex>    Apply only the reviewed GitHub commit, preserving --ref
  --help                       Show this help

Examples:
  alfred skills list --json
  alfred skills install ./skills/tdd --harness codex
  alfred skills install ./skills/tdd --harness codex --apply
  alfred skills install https://github.com/owner/repo --skill skills/tdd --ref main --harness codex
  alfred skills update tdd --harness codex --scope project --apply
  alfred skills search release notes --limit 5 --json
  alfred skills add https://github.com/owner/repo --name selected-skill --harness codex

Chat authoring: $alfred skills create <idea> in Codex, or /alfred skills create
<idea> in OpenCode. Create is a conversational workflow, not a CLI scaffolder.
Codex uses the $alfred skill; this does not register a native /alfred command.

Version is declared metadata when present; commit/digest identifies content.
Existing setup skills are unmanaged. An explicit install from an identical
source can adopt them without rewriting files; different content is blocked.
Modified or missing managed skills cannot be updated or removed automatically.
Inventory covers native .agents/skills and .opencode/skills project roots,
home/.agents/skills and XDG_CONFIG_HOME/opencode/skills (home/.config fallback).
Plugin/system caches, legacy/compatibility, custom and ancestor roots are excluded.
A new harness session may be required after changes; discovery does not prove loading.
`;

function parse(argv) {
  const values = new Set(["cwd", "scope", "harness", "skill", "name", "ref", "limit", "expected-digest", "expected-commit"]);
  const booleans = new Set(["json", "apply", "dry-run", "help"]);
  const result = { positional: [] };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "-h") { result.help = true; continue; }
    if (!arg.startsWith("-")) { result.positional.push(arg); continue; }
    const match = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) fail("E_ARGUMENT", `Unknown option: ${arg}`);
    const [, key, inline] = match;
    if (result[key] !== undefined) fail("E_ARGUMENT", `Duplicate option: --${key}`);
    if (booleans.has(key)) {
      if (inline !== undefined) fail("E_ARGUMENT", `--${key} does not accept a value.`);
      result[key] = true;
    } else if (values.has(key)) {
      const value = inline ?? argv[++index];
      if (!value || value.startsWith("--")) fail("E_ARGUMENT", `--${key} requires a value.`);
      result[key] = value;
    } else fail("E_ARGUMENT", `Unknown option: --${key}`);
  }
  return result;
}

function revision(row) {
  const version = row?.declaredVersion ? `declared ${row.declaredVersion}; ` : "";
  const commit = row?.source?.resolvedCommit;
  const digest = row?.installedDigest ?? row?.observedDigest;
  return `${version}${commit ? `commit ${commit.slice(0, 12)}` : digest ? digest.slice(0, 19) : "unknown"}`;
}

function render(result) {
  if (result.catalog) {
    return [`Catalog: ${result.catalog} (search results, not installed skills)`, `Query: ${result.query}`, `Retrieved: ${result.retrievedAt}`,
      ...(result.results.length ? result.results.map((row) => `${row.name}  ${row.source}  name=${row.skillId}${row.installs === null ? "" : `  reported installs=${row.installs}`}\n  ${row.url}\n  ${row.repository}`) : ["No catalog matches."]),
      "Reported counts are catalog metrics, not quality or safety evidence."].join("\n");
  }
  if (result.status === "valid") return `VALID: ${result.name}\nSource: ${result.source.path}\nDigest: ${result.digest}\nFiles: ${result.files.length}\nStructural validation passed; review the skill's behavior and example separately.`;
  if (result.installations || result.installation) {
    const rows = result.installations ?? [result.installation];
    const lines = rows.length ? rows.map((row) => `${row.name}  ${row.harness}/${row.scope}  ${row.management}/${row.integrity}\n  ${revision(row)}\n  ${row.targetPath}${row.source ? `\n  source: ${row.source.kind === "local" ? row.source.path : `${row.source.repository}/${row.source.skillPath} (${row.source.requestedRef})`}` : "\n  source/history: unknown"}${row.diagnostic ? `\n  ${row.diagnostic.message}` : ""}`) : ["No skills found in the selected roots."];
    lines.push("", "Scanned roots:", ...result.coverage.roots.map((root) => `  ${root.harness}/${root.scope}: ${root.path}`), `Not included: ${result.coverage.exclusions.join(", ")}.`);
    for (const diagnostic of result.diagnostics) lines.push(`Diagnostic: ${diagnostic.path}: ${diagnostic.message}`);
    return lines.join("\n");
  }
  return [
    `${result.status.toUpperCase()}: ${result.action === "none" ? result.operation : result.action} ${result.name} (${result.harness}/${result.scope})`,
    `Destination: ${result.targetPath}`,
    `Source: ${result.source?.kind === "local" ? result.source.path : result.source ? `${result.source.repository}/${result.source.skillPath} (${result.source.requestedRef})` : "unknown"}`,
    `Current: ${result.current ? `${result.current.management}/${result.current.integrity}; ${revision(result.current)}` : "absent"}`,
    ...(result.candidate ? [`Candidate: ${revision({ ...result.candidate, source: result.source })}`] : []),
    `Files (${result.files.length}): ${result.files.join(", ") || "none"}`,
    ...result.blockers.map((blocker) => `Blocked: ${blocker.message}`),
    result.status === "preview" ? "Review this plan and rerun with --apply to authorize it." : "",
    result.status === "applied" ? "A new harness session may be required to load the change." : ""
  ].filter(Boolean).join("\n");
}

export async function run(argv, env = process.env) {
  let args;
  try {
    args = parse(argv);
    const [requestedOperation, value, ...extra] = args.positional;
    const operation = requestedOperation === "add" ? "install" : requestedOperation;
    if (args.help || !operation) { process.stdout.write(help); return 0; }
    if (!["list", "info", "install", "update", "remove", "search", "validate"].includes(operation)) fail("E_ARGUMENT", `Unknown skills command: ${operation}; create is a chat workflow, not a CLI subcommand.`);
    if ((operation !== "search" && extra.length) || (operation === "list" ? value !== undefined : !value)) fail("E_ARGUMENT", `Invalid arguments for skills ${operation}; run --help.`);
    const mutating = ["install", "update", "remove"].includes(operation);
    if (!mutating && (args.apply || args["dry-run"])) fail("E_ARGUMENT", "--apply and --dry-run are only valid for mutations.");
    if (args.skill !== undefined && operation !== "install") fail("E_ARGUMENT", "--skill is only valid for install.");
    if (args.name !== undefined && operation !== "install") fail("E_ARGUMENT", "--name is only valid for add/install.");
    if (args.name !== undefined && args.skill !== undefined) fail("E_ARGUMENT", "--name and --skill are mutually exclusive selectors.");
    if (args.ref !== undefined && !["install", "update"].includes(operation)) fail("E_ARGUMENT", "--ref is only valid for install/update.");
    if (args.limit !== undefined && operation !== "search") fail("E_ARGUMENT", "--limit is only valid for search.");
    if ((args["expected-digest"] !== undefined || args["expected-commit"] !== undefined) && (!mutating || !args.apply)) fail("E_ARGUMENT", "Reviewed-content guards require a mutation with --apply.");
    if (["search", "validate"].includes(operation) && (args.harness !== undefined || args.scope !== undefined)) fail("E_ARGUMENT", `${operation} does not accept --scope or --harness.`);
    const selection = { scope: args.scope, harness: args.harness };
    let result;
    if (operation === "search") {
      if (args.limit !== undefined && !/^\d+$/.test(args.limit)) fail("E_ARGUMENT", "Search --limit must be an integer from 1 to 20.");
      result = await searchSkills([value, ...extra].join(" "), { limit: args.limit === undefined ? 10 : Number(args.limit) });
    } else if (operation === "validate") result = validateSkillDirectory(value, { cwd: args.cwd ?? process.cwd() });
    else {
      const manager = createSkillManager({ cwd: args.cwd ?? process.cwd(), home: env.HOME || os.homedir(), env });
      if (operation === "list") result = manager.list(selection);
      else if (operation === "info") result = manager.info(value, selection);
      else {
        result = await manager.plan({ operation, ...selection, ...(operation === "install" ? { source: value, skill: args.skill, name: args.name } : { name: value }), ref: args.ref,
          expectedDigest: args["expected-digest"], expectedCommit: args["expected-commit"] });
        if (args.apply && !args["dry-run"]) {
          if (!args.json) process.stdout.write(`${render(result)}\n\n`);
          result = await manager.apply(result, { approval: true });
        }
      }
    }
    process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : `${render(result)}\n`);
    return result.status === "blocked" ? 1 : 0;
  } catch (error) {
    if (args?.json || argv.includes("--json")) process.stdout.write(`${JSON.stringify({ status: "failed", error: { code: error.code ?? "E_IO", message: error.message }, ...(error.trace ? { trace: error.trace } : {}), provider_calls: 0 })}\n`);
    else process.stderr.write(`skills: ${error.message}\n`);
    return error.code === "E_ARGUMENT" ? 2 : 1;
  }
}
