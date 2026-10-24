import { useEffect, useState } from 'react'
import { agentAccessSchema, parseMcpServers, type AgentAccess } from '../../shared/agent-access'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'

export function AgentAccessSettings({ conversationId }: { conversationId: string }) {
  const [access, setAccess] = useState<AgentAccess | null>(null)
  const [servers, setServers] = useState('[]')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setAccess(null)
    setError('')
    setNotice('')
    void api<AgentAccess>(`/conversations/${conversationId}/agent-access`, undefined, undefined, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        setAccess(value)
        setServers(JSON.stringify(value.servers, null, 2))
      }).catch((error) => { if (!controller.signal.aborted) setError(errorMessage(error)) })
    return () => controller.abort()
  }, [conversationId])
  async function save() {
    if (!access || saving) return
    setError('')
    setNotice('')
    let next: AgentAccess
    try {
      next = agentAccessSchema.parse({ terminal: access.terminal, servers: parseMcpServers(JSON.parse(servers)) })
    } catch (error) {
      setError(`Invalid configuration: ${errorMessage(error)}`)
      return
    }
    if (!window.confirm('Save agent access?\n\nThe current run will stop and the queue will pause without undoing completed actions. Terminal and MCP can access the host or external services; they are not sandboxed to the workspace. A stdio MCP starts a process even during tool discovery. Only authorize trusted servers.\n\nIn Full access, enabled terminal and authorized MCP servers connect and execute without prompting, including ask permissions. Explicit blocks are respected. Permissions persist for this conversation until revoked.')) return
    setSaving(true)
    try {
      await api(`/conversations/${conversationId}/agent-access`, { access: next, confirmed: true }, 'PUT')
      setAccess(next)
      setServers(JSON.stringify(next.servers, null, 2))
      setNotice('Access saved. The queue remains paused. MCP servers will connect when the next agent run starts.')
    } catch (error) { setError(errorMessage(error)) }
    finally { setSaving(false) }
  }
  return <section aria-label="Terminal and MCP servers">
    <h3>Terminal and MCP</h3>
    <p>Persistent access per conversation. Both are blocked in Read only. Ask for approval confirms each execution.</p>
    {!access && !error && <p role="status">Loading access settings…</p>}
    {access && <fieldset disabled={saving}>
      <legend>Authorized capabilities</legend>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 44, paddingBlock: 10 }}>
        <input type="checkbox" checked={access.terminal} aria-describedby={`terminal-note-${conversationId}`} onChange={(event) => setAccess({ ...access, terminal: event.target.checked })} style={{ flex: '0 0 auto', width: 18, height: 18, margin: '1px 0 0', accentColor: 'var(--primary)' }} />
        <span style={{ minWidth: 0 }}>Allow agent terminal</span>
      </label>
      <p id={`terminal-note-${conversationId}`}>Runs non-interactive commands on the host. This is not a sandbox: the starting directory does not prevent access outside the workspace.</p>
      <label htmlFor={`mcp-${conversationId}`}>MCP servers (JSON)</label>
      <textarea id={`mcp-${conversationId}`} rows={12} spellCheck={false} value={servers} onChange={(event) => setServers(event.target.value)} style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'monospace' }} />
      <p>Accepts an object <code>{'{"mcpServers": {"name": {"command": "npx", "args": []}}}'}</code>, a named server array, or the internal list shown below. Imported servers use ask: approval is requested except in Full access. Unsupported options such as env and headers are rejected, not ignored.</p>
      <p>Transport <code>stdio</code>: command and args. Transport <code>http</code>: Streamable HTTP URL. Do not include secrets in arguments or URLs; this configuration is not a credential store.</p>
      <p>Permissions: <code>blocked</code>, <code>ask</code> or <code>allow</code>. Server permissions are inherited; <code>tools</code> allows overrides by tool name. A blocked server always remains blocked.</p>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify([{ id: 'my-server', transport: { type: 'http', url: 'http://localhost:3000/mcp' }, permission: 'ask', tools: { restricted_tool: 'blocked' } }], null, 2)}</pre>
      <p>To revoke access, uncheck terminal, block the server, or remove it from the list and save. Connections close when the run completes or stops; their status and errors appear in chat notes.</p>
      <Button type="button" onClick={() => void save()} disabled={saving}>{saving ? 'Stopping and saving…' : 'Stop and save access'}</Button>
    </fieldset>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
  </section>
}
