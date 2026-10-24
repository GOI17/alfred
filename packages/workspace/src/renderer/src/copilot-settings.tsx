import { useEffect, useState } from 'react'
import type { PublicState } from '../../shared/contracts'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'

export function CopilotSettings({ state }: { state: PublicState }) {
  const connected = state.providers.some((item) => item.id === 'copilot')
  const [flow, setFlow] = useState<{ id: string; code: string; url: string }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!flow) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const result = await api<{ connected: boolean }>('/copilot/poll', { id: flow.id })
        if (cancelled) return
        if (result.connected) setFlow(undefined)
        else timer = setTimeout(() => void poll(), 5000)
      } catch (error) {
        if (!cancelled) { setError(errorMessage(error)); setFlow(undefined) }
      }
    }
    timer = setTimeout(() => void poll(), 5000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [flow])
  return <section aria-labelledby="copilot-heading">
    <h3 id="copilot-heading">GitHub Copilot</h3>
    <p>Connect your GitHub account. Requires Copilot access and permission from your organization, when applicable.</p>
    <p role="status">{connected ? 'Connected. Choose an available model in the model picker.' : 'Not connected'}</p>
    {flow && <p>Open <a href={flow.url} target="_blank" rel="noreferrer">GitHub device activation</a> and enter <strong>{flow.code}</strong>. Waiting for authorization…</p>}
    {error && <p role="alert" className="error-text">{error}</p>}
    <Button disabled={busy || !!flow} onClick={async () => {
      setBusy(true); setError('')
      try { setFlow(await api('/copilot/authorize', {})) }
      catch (error) { setError(errorMessage(error)) }
      finally { setBusy(false) }
    }}>{busy ? 'Connecting…' : connected ? 'Reconnect GitHub' : 'Connect GitHub'}</Button>
    {connected && <Button variant="danger" disabled={busy || !!flow} onClick={async () => {
      setBusy(true); setError('')
      try { await api('/providers/copilot', undefined, 'DELETE') }
      catch (error) { setError(errorMessage(error)) }
      finally { setBusy(false) }
    }}>Disconnect</Button>}
  </section>
}
