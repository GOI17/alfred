import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { initializeRuntime, runtimeStatus, locateRuntimeWorkspace, runManagedRequest } from "./service.mjs";

const help = `alfred runtime <init|run|status>
  init --instructions /absolute/shared/instructions.json [--cwd PATH]
  run --action ACTION --scope SCOPE [--option ID] [--cwd PATH] [--non-interactive]
  status [--cwd PATH]

Global catalog: ~/.alfred/runtime/options.json
Managed capability: read-text-v1 (approved local instruction loading).
Returns JSON with validated text content; it does not execute that text or open URLs.
Native Codex/Pi/OpenCode/Copilot tools are not intercepted.
`;
// JSON escapes controls; also escape bidi/format characters that can disguise labels.
const unsafe = /[\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/gu;
const unsafeLabel = new RegExp(unsafe.source, "u");
const encode = value => JSON.stringify(value).replace(unsafe, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
function parse(argv) {
  const [command, ...args] = argv;
  const allowed = { init: ["cwd", "instructions"], status: ["cwd"], run: ["cwd", "action", "scope", "option", "non-interactive"] }[command];
  if (!allowed) throw new Error("invalid_arguments");
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const [flag, ...inline] = args[i].split("=");
    const key = flag.slice(2);
    if (!flag.startsWith("--") || !allowed.includes(key) || Object.hasOwn(flags, key)) throw new Error("invalid_arguments");
    if (key === "non-interactive") {
      if (inline.length) throw new Error("invalid_arguments");
      flags[key] = true;
      continue;
    }
    const value = inline.length ? inline.join("=") : args[++i];
    if (!value || value.startsWith("--") || /[\x00-\x1f]/u.test(value) || unsafeLabel.test(value)) throw new Error("invalid_arguments");
    flags[key] = value;
  }
  if (command === "init" && (!flags.instructions || !path.isAbsolute(flags.instructions))) throw new Error("invalid_arguments");
  if (command === "run" && (!flags.action || !flags.scope)) throw new Error("invalid_arguments");
  return { command, flags };
}

function projectTrace(workspace) {
  const directory = path.join(workspace, ".alfred/runtime");
  const file = path.join(directory, "trace.jsonl");
  return event => {
    // Recheck directories and the open file on every append; never follow trace links.
    for (const dir of [workspace, path.join(workspace, ".alfred"), directory]) {
      if (fs.realpathSync(dir) !== dir || !fs.lstatSync(dir).isDirectory()) throw new Error("invalid_trace_path");
    }
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW, 0o600);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1) throw new Error("invalid_trace_path");
      const record = { timestamp: new Date().toISOString() };
      // Deliberately exclude option paths, content, input and arbitrary port payloads.
      for (const key of ["event", "request_id", "status", "reason", "authority", "outcome", "count", "valid", "allowed", "choice"]) {
        if (["string", "number", "boolean"].includes(typeof event[key])) record[key] = event[key];
      }
      fs.writeFileSync(fd, encode(record) + "\n");
    } finally { fs.closeSync(fd); }
  };
}

export async function run(argv, env = process.env, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const stdin = io.stdin ?? process.stdin;
  const print = value => stdout.write(encode(value) + "\n");
  if (!argv.length || (argv.length === 1 && ["--help", "-h"].includes(argv[0])) ||
      (argv.length === 2 && ["init", "run", "status"].includes(argv[0]) && ["--help", "-h"].includes(argv[1]))) {
    stdout.write(help);
    return 0;
  }
  let parsed;
  try { parsed = parse(argv); }
  catch { print({ status: "failed", reason: "invalid_arguments" }); return 2; }
  const { command, flags } = parsed;
  const cwd = flags.cwd ?? process.cwd();
  const interactive = !flags["non-interactive"] && (io.interactive ?? Boolean(stdin.isTTY && stderr.isTTY));
  let reader;
  const question = async prompt => {
    if (!interactive) return undefined;
    if (io.question) return io.question(prompt);
    reader ??= createInterface({ input: stdin, output: stderr });
    if (reader.closed) return undefined;
    // EOF is cancellation, including when a terminal closes while awaiting consent.
    const controller = new AbortController();
    const close = () => controller.abort();
    reader.once("close", close);
    try { return await reader.question(prompt, { signal: controller.signal }); }
    catch (error) { if (error.name === "AbortError") return undefined; throw error; }
    finally { reader.off("close", close); }
  };
  let failureTrace;
  const show = option => stderr.write(
    `Opción: ${encode(option.id)}\nOrigen: ${encode(option.source)}\nAcción: ${encode(option.action)}\nAlcance: ${encode(option.scope)}\nContrato: ${encode(option.contract)}\nSHA-256: ${encode(option.digest)}\n`
  );
  try {
    if (command !== "run") {
      const result = command === "init" ? initializeRuntime({ cwd, instructions: flags.instructions }) : runtimeStatus({ cwd });
      projectTrace(result.workspace_id)({ event: `runtime_${command}_completed`, request_id: randomUUID() });
      print(result);
      return 0;
    }
    const workspace = locateRuntimeWorkspace(cwd);
    failureTrace = projectTrace(workspace);
    const result = await runManagedRequest({
      cwd, home: env.HOME || homedir(), action: flags.action, scope: flags.scope, option_id: flags.option,
      selectOption: async (_request, options) => {
        if (!interactive) return options.length === 1 ? options[0].id : undefined;
        stderr.write("Tengo estas opciones fuera de Alfred\n");
        options.forEach((option, index) => { stderr.write(`${index + 1}. `); show(option); });
        const answer = await question("Selecciona el número de opción o Cancelar: ");
        if (answer === "Cancelar" || answer === undefined) return null;
        if (!/^[1-9][0-9]*$/.test(answer) || !options[Number(answer) - 1]) return undefined;
        return options[Number(answer) - 1].id;
      },
      consent: async (_request, option, binding) => {
        if (!interactive) return undefined;
        stderr.write("Tengo estas opciones fuera de Alfred\n");
        show(option);
        const answer = await question("Permitir / Permitir siempre / Cancelar: ");
        if (answer === undefined) return undefined;
        const choices = new Map([["Permitir", "once"], ["Permitir siempre", "always"], ["Cancelar", "cancel"]]);
        return { choice: choices.get(answer), binding };
      },
      trace: failureTrace
    });
    print(result);
    return result.status === "completed" ? 0 : 1;
  } catch {
    try { failureTrace?.({ event: "runtime_cli_failed", request_id: randomUUID(), status: "failed", reason: "runtime_failure" }); }
    catch { /* Trace failures must also fail closed without exposing paths or content. */ }
    print({ status: "failed", reason: "runtime_failure" });
    return 1;
  } finally { reader?.close(); }
}
