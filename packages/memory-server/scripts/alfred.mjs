#!/usr/bin/env node
// Legacy product entrypoint; standalone Memory uses memory.mjs.
import { realpathSync } from "node:fs";
import { run } from "../../cli/scripts/alfred.mjs";
export { run };
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) process.exitCode = await run(process.argv.slice(2));
