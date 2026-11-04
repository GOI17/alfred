import { useCallback, useEffect, useState } from 'react'
import type { PublicState } from '../../shared/contracts'
import { api } from './api'
import { useCompletionReading } from './agent-completion'

export function useWorkspace() {
  const [state, setState] = useState<PublicState>()
  const [authenticated, setAuthenticated] = useState<boolean>()
  const [connected, setConnected] = useState(false)
  // Reading detection is installed once for the whole workspace, only with loaded state.
  useCompletionReading(state!, connected && !!state)
  const refresh = useCallback(async () => {
    const next = await api<PublicState>('/state')
    setState(next)
    setAuthenticated(true)
  }, [])
  useEffect(() => {
    void refresh().catch(() => setAuthenticated(false))
  }, [refresh])
  useEffect(() => {
    if (!authenticated) return
    const events = new EventSource('/api/events')
    events.addEventListener('state', (event) => {
      setState(JSON.parse(event.data))
      setConnected(true)
    })
    events.onerror = () => setConnected(false)
    return () => events.close()
  }, [authenticated])
  return { state, authenticated, connected, refresh }
}
