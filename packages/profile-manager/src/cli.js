#!/usr/bin/env node
import os from "node:os";
import {
  activateProfile,
  buildProfileActivationPlan,
  doctorProfileManager,
  initProfileRepository
} from "./index.js";

function usage() {
  console.error(`Usage:
  alfred-profile init --repo <path> [--git]
  alfred-profile doctor --repo <path> [--profile <name> --agent <agent>] [--home <path>]
  alfred-profile plan --repo <path> --profile <name> --agent <agent> [--home <path>]
  alfred-profile switch --repo <path> --profile <name> --agent <agent> [--home <path>] [--dry-run] [--force]
`);
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      result._.push(arg);
      continue;
    }
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (["dry-run", "force", "git"].includes(key)) {
      result[key] = true;
      continue;
    }
    result[key] = inlineValue ?? argv[++index];
  }
  return result;
}

function requireArg(args, name) {
  if (!args[name]) {
    usage();
    process.exit(2);
  }
  return args[name];
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const homeDir = args.home ?? os.homedir();
let result;

try {
  switch (command) {
    case "init":
      result = initProfileRepository({ repoPath: requireArg(args, "repo"), initializeGit: args.git === true });
      break;
    case "doctor":
      result = doctorProfileManager({ repoPath: requireArg(args, "repo"), profile: args.profile, agent: args.agent, homeDir });
      break;
    case "plan":
      result = buildProfileActivationPlan({
        repoPath: requireArg(args, "repo"),
        profile: requireArg(args, "profile"),
        agent: requireArg(args, "agent"),
        homeDir
      });
      break;
    case "switch":
      result = activateProfile({
        repoPath: requireArg(args, "repo"),
        profile: requireArg(args, "profile"),
        agent: requireArg(args, "agent"),
        homeDir,
        dryRun: args["dry-run"] === true,
        force: args.force === true
      });
      break;
    default:
      usage();
      process.exit(2);
  }
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
