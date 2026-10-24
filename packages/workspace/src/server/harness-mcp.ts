import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import type { HarnessId } from '../shared/harnesses.js'
import { record, string, strings } from './harness-files.js'

const values = z.record(z.string().min(1).max(200).refine((value) => [...value].every((character) => character.charCodeAt(0) >= 32)), z.string().max(16000))
const transportSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('stdio'), command: z.string().min(1).max(4000), args: z.array(z.string().max(16000)).max(100), env: values, cwd: z.string() }),
  z.object({ type: z.literal('http'), url: z.string().url().refine((value) => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash && !url.search }), headers: values }),
])
export type HarnessMcpTransport = z.infer<typeof transportSchema>
export interface HarnessMcp { transport?: HarnessMcpTransport; reason?: string; summary: string; details: string[]; enabledTools?: string[]; disabledTools?: string[] }

/** Credentials stay on the server. Discovery never connects or runs a helper command. */
export function parseHarnessMcp(harness: HarnessId, input: unknown, root: string, env: NodeJS.ProcessEnv): HarnessMcp {
  const value = record(input)
  const details: string[] = []
  let summary = 'MCP server'
  const unsupported = (reason: string): HarnessMcp => ({ reason, summary, details })
  if (value.enabled === false || value.disabled === true) return unsupported('Disabled in the harness configuration.')
  if (value.type === 'sse' || value.type === 'ws' || value.type === 'websocket') return unsupported('This transport requires the native harness; Alfred supports stdio and Streamable HTTP.')
  if (value.oauth || value.http_headers_helper || value.experimental_environment === 'remote') return unsupported('Native OAuth, header helpers or remote execution require the original harness.')
  try {
    const expand = (text: string) => text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}|\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_all, first: string | undefined, fallback: string | undefined, second: string | undefined) => {
      const key = first || second || ''
      const result = env[key] ?? fallback
      if (result === undefined) throw new Error(`Missing environment variable: ${key}.`)
      return result
    })
    const map = (input: unknown) => Object.fromEntries(Object.entries(values.parse(input || {})).map(([key, value]) => [key, expand(value)]))
    const commonKeys = ['type', 'command', 'args', 'env', 'environment', 'env_vars', 'cwd', 'url', 'headers', 'http_headers', 'env_http_headers', 'bearer_token_env_var', 'enabled', 'disabled', 'oauth', 'enabled_tools', 'disabled_tools', 'startup_timeout_sec', 'startup_timeout_ms', 'tool_timeout_sec', 'timeout', 'required']
    const unknown = Object.keys(value).filter((key) => !commonKeys.includes(key))
    if (unknown.length) return unsupported(`Unsupported MCP options: ${unknown.join(', ')}.`)
    if (['timeout', 'startup_timeout_sec', 'startup_timeout_ms', 'tool_timeout_sec'].some((key) => key in value)) details.push('Alfred connection and execution timeouts apply.')
    let transport: HarnessMcpTransport
    if (value.url) {
      if (['command', 'args', 'cwd', 'env', 'environment', 'env_vars'].some((key) => key in value)) return unsupported('Process options cannot be applied to an HTTP transport.')
      const url = expand(string(value.url))
      if (url.includes('{file:')) return unsupported('File interpolation must be configured as an environment variable.')
      const headers = { ...map(value.http_headers), ...map(value.headers) }
      for (const [header, key] of Object.entries(values.parse(value.env_http_headers || {}))) {
        if (!env[key]) throw new Error(`Missing environment variable: ${key}.`)
        headers[header] = env[key]!
      }
      const bearer = string(value.bearer_token_env_var)
      if (bearer) {
        if (!env[bearer]) throw new Error(`Missing environment variable: ${bearer}.`)
        headers.Authorization = `Bearer ${env[bearer]}`
      }
      if (Object.values(headers).some((value) => value.includes('{file:'))) return unsupported('File interpolation must be configured as an environment variable.')
      transport = transportSchema.parse({ type: 'http', url, headers })
      // Do not expose URL paths, queries, header values or process arguments in the catalog.
      summary = `Streamable HTTP · ${new URL(url).origin}`
      if (Object.keys(headers).length) details.push('Authentication headers stay on the server.')
    } else {
      if (['headers', 'http_headers', 'env_http_headers', 'bearer_token_env_var'].some((key) => key in value)) return unsupported('HTTP options cannot be applied to a stdio transport.')
      const commandArray = Array.isArray(value.command) ? z.array(z.string()).min(1).parse(value.command) : undefined
      const command = expand(commandArray?.[0] || string(value.command))
      const args = (commandArray ? commandArray.slice(1) : z.array(z.string()).parse(value.args || [])).map(expand)
      const environment = { ...map(value.env), ...map(value.environment) }
      for (const entry of Array.isArray(value.env_vars) ? value.env_vars : []) {
        const key = typeof entry === 'string' ? entry : string(record(entry).name)
        if (typeof entry !== 'string' && record(entry).source === 'remote') return unsupported('Remote environment variables require the native harness.')
        if (!key || !env[key]) throw new Error(`Missing environment variable: ${key || '(unnamed)'}.`)
        environment[key] = env[key]!
      }
      if ([command, ...args, ...Object.values(environment)].some((item) => /\{file:|\0/.test(item))) return unsupported('Unsupported file interpolation or invalid process argument.')
      const cwd = string(value.cwd) ? resolve(root, expand(string(value.cwd))) : root
      transport = transportSchema.parse({ type: 'stdio', command: command.includes('/') && !isAbsolute(command) ? resolve(root, command) : command, args, env: environment, cwd })
      summary = 'Local process · stdio'
      if (Object.keys(environment).length) details.push('Environment values stay on the server.')
    }
    if (harness === 'opencode' && value.type && !['local', 'remote'].includes(string(value.type))) return unsupported('Unsupported OpenCode MCP transport.')
    return { transport, summary, details, enabledTools: 'enabled_tools' in value ? strings(value.enabled_tools) : undefined, disabledTools: strings(value.disabled_tools) }
  } catch (error) {
    return unsupported(error instanceof Error && error.message.startsWith('Missing environment variable:') ? error.message : 'Invalid MCP configuration; review it in the source file.')
  }
}
