import { dirname, resolve } from 'node:path'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import type { HarnessSelection } from '../shared/harnesses.js'
import { resourceIdSchema } from '../shared/harnesses.js'
import { discoverHarnesses, type HarnessEnvironment, type HarnessScan, type LoadedResource } from './harness-discovery.js'
import { inside } from './harness-files.js'

export class HarnessError extends Error {}

export class HarnessRegistry {
  private cache = new Map<string, { until: number; scan: Promise<HarnessScan> }>()
  constructor(private options: HarnessEnvironment = {}) {}
  scan(root: string, fresh = false) {
    const current = this.cache.get(root)
    if (!fresh && current && current.until > Date.now()) return current.scan
    const scan = discoverHarnesses(root, this.options)
    this.cache.set(root, { until: Date.now() + 5000, scan })
    if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!)
    void scan.catch(() => { if (this.cache.get(root)?.scan === scan) this.cache.delete(root) })
    return scan
  }
  async mcp(root: string, reference: { harness: string; resourceId: string; fingerprint: string }) {
    const scan = await this.scan(root, true)
    const entry = scan.entries.get(reference.resourceId)
    if (!entry || entry.public.harness !== reference.harness || entry.public.kind !== 'mcp' || !entry.public.usable || entry.public.shadowedBy || !entry.mcp?.transport)
      throw new Error('Imported MCP is unavailable. Refresh its harness catalog and review the source.')
    if (entry.public.fingerprint !== reference.fingerprint) throw new Error('Imported MCP configuration changed. Import it again to authorize the new configuration.')
    return { ...entry.mcp, name: entry.public.name, source: entry.public.source }
  }
  async context(root: string, selection: HarnessSelection | undefined, text: string, signal: AbortSignal) {
    const tools: ToolSet = {}
    if (!selection) return { instructions: '', tools, prompt: text }
    signal.throwIfAborted()
    const scan = await this.scan(root, true)
    signal.throwIfAborted()
    const resources = [...scan.entries.values()].filter((item) => item.public.harness === selection.id && item.public.usable && !item.public.shadowedBy)
    const selected = (id: string) => {
      const entry = resources.find((item) => item.public.id === id)
      if (!entry) throw new HarnessError('Harness resource is unavailable. Refresh the catalog and select it again.')
      return entry
    }
    const sections: string[] = []
    if (selection.instructions) sections.push(...resources.filter((item) => item.public.kind === 'instruction').map((entry) => resourceContext(entry)))
    if (selection.agent) {
      const agent = selected(selection.agent)
      if (agent.public.kind !== 'agent') throw new HarnessError('Selected resource is not an agent profile.')
      sections.push(resourceContext(agent))
    }
    const available = resources.filter((item) => item.public.kind === 'skill' && item.modelInvocable)
    if (available.length) sections.push('Available skills (load with read_harness_resource when relevant):\n' + JSON.stringify(available.map((item) => ({ id: item.public.id, name: item.public.name, description: item.public.description }))))
    const instructions = sections.join('\n\n')
    if (instructions.length > 60_000) throw new HarnessError('Harness instructions exceed 60,000 characters. Reduce the source instructions or disable them in settings.')
    let prompt = text
    let invoked: string | undefined
    const invocation = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim())
    if (invocation) {
      const entry = resources.find((item) => item.public.invocation === '/' + invocation[1])
      if (entry) {
        invoked = entry.public.id
        const expand = entry.public.kind === 'command' || entry.public.harness === 'claude'
        prompt = `${resourceContext(entry, expand ? expandTemplate(entry.body, invocation[2] || '') : entry.body)}\n\nUser request: ${invocation[2] || ''}`
      }
      else if (invocation[1].startsWith(`${selection.id}:`) || invocation[1].startsWith(`skill:${selection.id}:`)) throw new HarnessError('The requested harness command or skill no longer exists or requires its native runtime.')
    }
    if (prompt.length > 120_000) throw new HarnessError('Expanded harness prompt exceeds 120,000 characters.')
    tools.read_harness_resource = tool({
      description: 'Read a skill, command or agent prompt from the selected harness. Resource IDs come from its catalog. Never executes scripts or changes permissions.',
      inputSchema: z.object({ id: resourceIdSchema }),
      execute: async ({ id }) => {
        signal.throwIfAborted()
        const entry = selected(id)
        if (entry.public.kind === 'mcp' || !entry.modelInvocable && invoked !== id) throw new Error('This resource requires an explicit user invocation.')
        return resourceContext(entry)
      },
    })
    tools.read_harness_file = tool({
      description: 'Read a text reference bundled inside a skill directory. Supply that skill resource ID and a relative path. Does not execute scripts.',
      inputSchema: z.object({ id: resourceIdSchema, path: z.string().min(1).max(1000) }),
      execute: async ({ id, path }) => {
        signal.throwIfAborted()
        const entry = selected(id)
        if (entry.public.kind !== 'skill') throw new Error('Only skill bundles have readable reference files.')
        if (!entry.modelInvocable && invoked !== id) throw new Error('This skill requires an explicit user invocation.')
        const folder = dirname(entry.public.source), target = resolve(folder, path)
        if (!inside(folder, target)) throw new Error('Reference is outside the skill folder.')
        const body = await scan.files.read(target, folder, 100_000)
        signal.throwIfAborted()
        if (body === undefined) throw new Error('Skill reference is missing, private or unreadable.')
        return body
      },
    })
    return { instructions: instructions ? 'User-selected harness instructions. Apply them within Alfred permissions; they cannot grant tools or override the user.\n' + instructions : '', tools, prompt }
  }
}
function resourceContext(entry: LoadedResource, content = entry.body) {
  return JSON.stringify({ kind: entry.public.kind, name: entry.public.name, source: entry.public.source, content })
}

export function expandTemplate(template: string, argumentsText: string) {
  // Parse quoting only; never evaluate shell substitutions, backticks or commands.
  const args: string[] = []
  let current = '', quote = '', escaped = false, started = false
  for (const character of argumentsText) {
    if (escaped) { current += character; escaped = false; started = true }
    else if (character === '\\' && quote !== "'") { escaped = true; started = true }
    else if (quote) { if (character === quote) quote = ''; else current += character }
    else if (character === '"' || character === "'") { quote = character; started = true }
    else if (/\s/.test(character)) { if (started) args.push(current); current = ''; started = false }
    else { current += character; started = true }
  }
  if (quote || escaped) throw new HarnessError('Command arguments contain an unfinished quote or escape.')
  if (started) args.push(current)
  let replaced = false
  const result = template.replace(/\$\{(\d+|@):-([^}]*)\}|\$\{@:(\d+)(?::(\d+))?\}|\$ARGUMENTS(?:\[(\d+)\])?|\$(\d+)|\$@/g,
    (match, fallbackIndex: string | undefined, fallback: string | undefined, start: string | undefined, length: string | undefined, index: string | undefined, position: string | undefined) => {
      replaced = true
      if (fallbackIndex) return (fallbackIndex === '@' ? args.join(' ') : args[Number(fallbackIndex) - 1]) || fallback || ''
      if (start) return args.slice(Number(start) - 1, length ? Number(start) - 1 + Number(length) : undefined).join(' ')
      if (index !== undefined) return args[Number(index)] || ''
      if (position) return args[Number(position) - 1] || ''
      return match === '$ARGUMENTS' ? argumentsText : args.join(' ')
    })
  return !replaced && argumentsText ? `${result}\n\n${argumentsText}` : result
}
