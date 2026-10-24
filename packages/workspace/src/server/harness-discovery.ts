import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { HarnessCatalog, HarnessId, HarnessResource, HarnessResourceKind } from '../shared/harnesses.js'
import { harnessNames } from '../shared/harnesses.js'
import { digest, executable, exists, HarnessFiles, inside, markdown, record, string, strings } from './harness-files.js'
import { parseHarnessMcp, type HarnessMcp } from './harness-mcp.js'

export interface HarnessEnvironment { home?: string; env?: NodeJS.ProcessEnv }
export interface LoadedResource { public: HarnessResource; body: string; boundary: string; modelInvocable: boolean; mcp?: HarnessMcp }
export interface HarnessScan { catalog: HarnessCatalog; entries: Map<string, LoadedResource>; files: HarnessFiles }
type Scope = HarnessResource['scope']

export async function discoverHarnesses(workspace: string, options: HarnessEnvironment = {}): Promise<HarnessScan> {
  const env = options.env || process.env
  const home = await realpath(options.home || homedir())
  const root = await realpath(workspace)
  const location = (value: string | undefined, fallback: string) => resolve(value ? value.replace(/^~(?=\/|$)/, home) : fallback)
  const userRoots: Record<HarnessId, string> = {
    codex: location(env.CODEX_HOME, join(home, '.codex')),
    claude: location(env.CLAUDE_CONFIG_DIR, join(home, '.claude')),
    opencode: location(env.OPENCODE_CONFIG_DIR, join(env.XDG_CONFIG_HOME || join(home, '.config'), 'opencode')),
    pi: location(env.PI_CODING_AGENT_DIR, join(home, '.pi/agent')),
  }
  const globalRoots = await Promise.all([home, ...Object.values(userRoots)].map(async (path) => { try { return await realpath(path) } catch { return path } }))
  const files = new HarnessFiles([root, ...globalRoots])
  const entries = new Map<string, LoadedResource>()
  const codexSkills = new Map<string, boolean>()
  const claudeSkills = new Map<string, string>()
  const catalog: HarnessCatalog = { harnesses: [], resources: [], issues: files.issues, scannedAt: new Date().toISOString() }
  const globalBoundary = (path: string) => inside(home, path) ? home : path
  function add(harness: HarnessId, kind: HarnessResourceKind, name: string, source: string, scope: Scope, body: string, metadata: Record<string, unknown>, boundary: string, mcp?: HarnessMcp, suffix = '') {
    if (entries.size >= 1000) { files.issue(source, 'Catalog limit reached; some resources were omitted.'); return }
    name = name.trim().slice(0, 128)
    if (!name || [...name].some((character) => character.charCodeAt(0) < 32)) { files.issue(source, 'Resource has an invalid name.'); return }
    const id = digest(`${harness}\0${kind}\0${source}\0${suffix}`).slice(0, 32)
    const dynamic = /!`|^\s*!\s+\S/m.test(body)
    const reason = mcp?.reason || (dynamic ? 'Dynamic shell expansion requires the native harness.' : undefined)
    const details = mcp?.details || []
    if (kind === 'agent' && ['model', 'tools', 'disallowedTools', 'permission', 'permissionMode', 'sandbox_mode', 'mcpServers', 'hooks'].some((key) => key in metadata)) details.push('Only the prompt is imported. Alfred model and permissions apply.')
    if (metadata.context === 'fork') details.push('Use as instructions in Alfred; native fork execution is not imported.')
    const slug = name.replace(/[^a-zA-Z0-9_.:-]/g, '-')
    const token = slug === name ? slug : `${slug}-${digest(name).slice(0, 8)}`
    const resource: HarnessResource = { id, harness, kind, name,
      description: (string(metadata.description) || (mcp ? mcp.summary : body.split('\n').find((line) => line.trim()) || '')).slice(0, 500),
      source, scope, fingerprint: digest(JSON.stringify({ body, metadata, mcp })), usable: !reason, reason, details,
      invocation: metadata['user-invocable'] === false ? undefined : kind === 'command' ? `/${harness}:${token}` : kind === 'skill' ? `/skill:${harness}:${token}` : undefined,
    }
    entries.set(id, { public: resource, body, boundary, modelInvocable: metadata['disable-model-invocation'] !== true, mcp })
  }
  async function document(harness: HarnessId, kind: HarnessResourceKind, path: string, scope: Scope, boundary: string, fallback: string) {
    const text = await files.read(path, boundary, 100_000)
    if (text === undefined) return
    try {
      const { metadata, body } = markdown(text)
      if (!body) { files.issue(path, 'Empty resource.'); return }
      add(harness, kind, string(metadata.name) || fallback, path, scope, body, metadata, boundary)
    } catch { files.issue(path, 'Invalid resource frontmatter.'); }
  }
  async function folder(harness: HarnessId, kind: 'command' | 'skill' | 'agent', path: string, scope: Scope, boundary: string) {
    for (const file of await files.walk(path, boundary, (name) => kind === 'skill' ? name === 'SKILL.md' : /\.md$/i.test(name))) {
      await document(harness, kind, file, scope, boundary, kind === 'skill' ? basename(dirname(file)) : relative(path, file).replace(/\.md$/i, '').replaceAll('\\', '/').replaceAll('/', ':'))
    }
  }
  function mcps(harness: HarnessId, value: unknown, path: string, scope: Scope, boundary: string, prefix = '') {
    for (const [name, config] of Object.entries(record(value)).slice(0, 100)) {
      const mcp = parseHarnessMcp(harness, config, root, env)
      add(harness, 'mcp', name, path, scope, '', record(config), boundary, mcp, prefix + name)
    }
  }
  async function codexConfig(path: string, scope: Scope, boundary: string) {
    const config = await files.config(path, boundary)
    if (!config) return
    mcps('codex', config.mcp_servers, path, scope, boundary)
    const skills = record(config.skills).config
    for (const value of Array.isArray(skills) ? skills : []) {
      const skill = record(value)
      if (string(skill.path) && typeof skill.enabled === 'boolean') {
        const source = resolve(dirname(path), string(skill.path).replace(/^~(?=\/|$)/, home))
        codexSkills.set(await realpath(source).catch(() => source), skill.enabled)
      }
    }
    if (string(config.developer_instructions)) add('codex', 'instruction', 'Developer instructions', path, scope, string(config.developer_instructions), {}, boundary, undefined, 'developer_instructions')
    for (const [name, value] of Object.entries(record(config.agents))) {
      const agent = record(value)
      if (!agent.config_file) continue
      const source = resolve(dirname(path), string(agent.config_file))
      const body = await files.config(source, boundary)
      if (body && string(body.developer_instructions)) add('codex', 'agent', name, source, scope, string(body.developer_instructions), { ...agent, ...body }, boundary)
    }
    if (config.plugins || config.marketplaces) files.issue(path, 'Native plugin catalogs are not executed. Local skill and agent files are discovered separately.')
  }
  async function codexAgents(path: string, scope: Scope, boundary: string) {
    for (const source of await files.walk(path, boundary, (name) => name.endsWith('.toml'))) {
      const value = await files.config(source, boundary)
      if (value && string(value.developer_instructions)) add('codex', 'agent', string(value.name) || basename(source, '.toml'), source, scope, string(value.developer_instructions), value, boundary)
    }
  }
  async function openCodeConfig(path: string, scope: Scope, boundary: string) {
    const config = await files.config(path, boundary)
    if (!config) return
    mcps('opencode', config.mcp, path, scope, boundary)
    for (const [key, kind, field] of [['command', 'command', 'template'], ['agent', 'agent', 'prompt']] as const) {
      for (const [name, value] of Object.entries(record(config[key]))) {
        const metadata = record(value)
        let body = string(metadata[field])
        const file = /^\{file:([^}]+)\}$/.exec(body)
        if (file) body = await files.read(resolve(dirname(path), file[1]), boundary, 100_000) || ''
        if (body && metadata.disable !== true) add('opencode', kind, name, path, scope, body, metadata, boundary, undefined, `${key}:${name}`)
      }
    }
    for (const instruction of strings(config.instructions)) {
      if (/https?:|[*?{}]/.test(instruction)) { files.issue(path, 'Remote or glob instruction paths require the native harness; use an explicit local file.'); continue }
      const source = resolve(dirname(path), instruction)
      await document('opencode', 'instruction', source, scope, boundary, basename(source))
    }
    for (const skill of strings(record(config.skills).paths)) await folder('opencode', 'skill', resolve(dirname(path), skill.replace(/^~(?=\/|$)/, home)), scope, boundary)
    if (config.plugin) files.issue(path, 'Executable OpenCode plugins are not loaded into Alfred.')
  }
  async function piConfig(path: string, scope: Scope, boundary: string) {
    const config = await files.config(path, boundary)
    if (!config) return
    for (const [key, kind] of [['skills', 'skill'], ['prompts', 'command']] as const) {
      for (const item of strings(config[key])) {
        if (/^[!+-]|[*?{}]/.test(item)) { files.issue(path, 'Resource filters require the native harness; use explicit paths.'); continue }
        const source = resolve(dirname(path), item.replace(/^~(?=\/|$)/, home))
        if (source.endsWith('.md')) await document('pi', kind, source, scope, boundary, basename(source, '.md'))
        else await folder('pi', kind, source, scope, boundary)
      }
    }
    if (config.extensions || config.packages) files.issue(path, 'Pi extension commands, MCP integrations and package execution require Pi. Local Markdown resources are supported.')
  }

  for (const harness of ['codex', 'claude', 'opencode', 'pi'] as const) {
    const user = userRoots[harness], local = join(root, `.${harness}`)
    const binary = await executable(harness === 'claude' ? 'claude' : harness, env.PATH || '')
    const info = { id: harness, name: harnessNames[harness], installed: !!binary, executable: binary, configured: false, roots: [user, local] }
    catalog.harnesses.push(info)
    for (const [directory, scope, boundary] of [[user, 'user', globalBoundary(user)], [local, 'workspace', root]] as const) {
      info.configured ||= await exists(directory)
      await folder(harness, 'skill', join(directory, 'skills'), scope, boundary)
      await folder(harness, 'command', join(directory, harness === 'codex' || harness === 'pi' ? 'prompts' : 'commands'), scope, boundary)
      if (harness !== 'pi') await folder(harness, 'agent', join(directory, 'agents'), scope, boundary)
      if (harness === 'codex') {
        await codexConfig(join(directory, 'config.toml'), scope, boundary)
        await codexAgents(join(directory, 'agents'), scope, boundary)
      }
      if (harness === 'opencode') {
        // Older OpenCode installations used singular directory names.
        await folder(harness, 'command', join(directory, 'command'), scope, boundary)
        await folder(harness, 'agent', join(directory, 'agent'), scope, boundary)
        await folder(harness, 'skill', join(directory, 'skill'), scope, boundary)
        for (const ext of ['json', 'jsonc']) await openCodeConfig(join(directory, `opencode.${ext}`), scope, boundary)
      }
      if (harness === 'pi') {
        await piConfig(join(directory, 'settings.json'), scope, boundary)
        await document(harness, 'instruction', join(directory, 'AGENTS.md'), scope, boundary, 'AGENTS.md')
        await document(harness, 'instruction', join(directory, 'SYSTEM.md'), scope, boundary, 'SYSTEM.md')
        await document(harness, 'instruction', join(directory, 'APPEND_SYSTEM.md'), scope, boundary, 'APPEND_SYSTEM.md')
      }
      if (harness === 'claude') {
        await document(harness, 'instruction', join(directory, 'CLAUDE.md'), scope, boundary, 'CLAUDE.md')
        for (const file of scope === 'workspace' ? ['settings.json', 'settings.local.json'] : ['settings.json']) {
          const path = join(directory, file)
          const config = await files.config(path, boundary)
          for (const [name, state] of Object.entries(record(config?.skillOverrides))) if (typeof state === 'string') claudeSkills.set(name, state)
          if (config?.enabledPlugins) files.issue(path, 'Native plugin execution is not imported. Local commands, skills and agents are available.')
        }
      }
      if (harness !== 'claude') await folder(harness, 'skill', join(scope === 'user' ? home : root, '.agents/skills'), scope, scope === 'user' ? home : root)
    }
    const userBoundary = globalBoundary(user)
    if (harness === 'claude') {
      const configPath = join(home, '.claude.json')
      const config = await files.config(configPath, home)
      mcps(harness, config?.mcpServers, configPath, 'user', home)
      mcps(harness, (await files.config(join(root, '.mcp.json'), root))?.mcpServers, join(root, '.mcp.json'), 'workspace', root)
      mcps(harness, record(record(config?.projects)[root]).mcpServers, configPath, 'workspace', home, `projects:${root}:`)
      await document(harness, 'instruction', join(root, 'CLAUDE.md'), 'workspace', root, 'CLAUDE.md')
      await document(harness, 'instruction', join(root, 'CLAUDE.local.md'), 'workspace', root, 'CLAUDE.local.md')
    } else {
      if (harness !== 'pi') {
        const instruction = harness === 'codex' && await exists(join(user, 'AGENTS.override.md')) ? 'AGENTS.override.md' : 'AGENTS.md'
        await document(harness, 'instruction', join(user, instruction), 'user', userBoundary, instruction)
      }
      const override = harness === 'codex' && await exists(join(root, 'AGENTS.override.md'))
      const instruction = override ? 'AGENTS.override.md' : harness === 'opencode' && !await exists(join(root, 'AGENTS.md')) ? 'CLAUDE.md' : 'AGENTS.md'
      await document(harness, 'instruction', join(root, instruction), 'workspace', root, instruction)
    }
    if (harness === 'opencode') {
      if (env.OPENCODE_CONFIG) await openCodeConfig(location(env.OPENCODE_CONFIG, ''), 'user', home)
      for (const ext of ['json', 'jsonc']) await openCodeConfig(join(root, `opencode.${ext}`), 'workspace', root)
      // OpenCode also recognises Claude's standard skills directories.
      await folder(harness, 'skill', join(home, '.claude/skills'), 'user', home)
      await folder(harness, 'skill', join(root, '.claude/skills'), 'workspace', root)
    }
  }
  catalog.resources = [...entries.values()].map((entry) => entry.public)
  for (const entry of entries.values()) {
    const resource = entry.public
    if (resource.kind !== 'skill' && resource.kind !== 'command') continue
    const state = resource.harness === 'claude' ? claudeSkills.get(resource.name) : undefined
    const codexDisabled = resource.harness === 'codex' && resource.kind === 'skill' && codexSkills.get(await realpath(dirname(resource.source)).catch(() => dirname(resource.source))) === false
    if (state === 'off' || codexDisabled) { resource.usable = false; resource.reason = 'Disabled in the harness configuration.' }
    if (state === 'user-invocable-only') entry.modelInvocable = false
    if (state === 'name-only') resource.description = resource.name
  }
  for (const info of catalog.harnesses) info.configured ||= catalog.resources.some((resource) => resource.harness === info.id)
  // Preserve all origins in the UI; deterministic project overrides for Alfred use.
  const preferred = new Map<string, HarnessResource>()
  for (const resource of catalog.resources) {
    if (resource.kind === 'instruction') continue
    const key = `${resource.harness}:${resource.kind}:${resource.name}`
    const previous = preferred.get(key)
    if (!previous) { preferred.set(key, resource); continue }
    const userSkillWins = resource.harness === 'claude' && resource.kind === 'skill'
    const wins = previous.scope === resource.scope || resource.scope === (userSkillWins ? 'user' : 'workspace')
    if (wins) { previous.shadowedBy = resource.id; preferred.set(key, resource) }
    else resource.shadowedBy = previous.id
  }
  return { catalog, entries, files }
}
