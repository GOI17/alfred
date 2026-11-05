import { applyStateDelta, type StateDelta } from '../../shared/state-delta'
import { useCallback, useEffect, useState } from 'react'
import type { PublicState } from '../../shared/contracts'
import { api } from './api'
import { useCompletionReading } from './agent-completion'

export function useWorkspace() {
  const [state, setState] = useState<PublicState>()
  const [authenticated, setAuthenticated] = useState<boolean>()
  const [streamGeneration, setStreamGeneration] = useState(0)
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
    let revision = 0
    let current: PublicState | undefined
    const events = new EventSource('/api/events?incremental=1')
    events.addEventListener('state', (event) => {
      current = JSON.parse(event.data) as PublicState
      revision = Number(event.lastEventId)
      setState(current)
      setConnected(true)
    })
    events.addEventListener('patch', (event) => {
      const patch = JSON.parse(event.data) as { base: number; revision: number; delta?: StateDelta }
      if (!current || patch.base !== revision) {
        // Never apply a delta to the wrong baseline; reconnect for a snapshot.
        events.close()
        setConnected(false)
        setStreamGeneration(value => value + 1)
        return
      }
      revision = patch.revision
      if (patch.delta) {
        current = applyStateDelta(current, patch.delta)
        setState(current)
      }
      setConnected(true)
    })
    events.onerror = () => setConnected(false)
    return () => events.close()
  }, [authenticated, streamGeneration])
  return { state, authenticated, connected, refresh }
}
