import { useEffect, useState } from 'react'
import { api, errorMessage } from './api'

export type TunnelStatus = {
  state: 'disabled' | 'stopped' | 'connecting' | 'connected' | 'stopping' | 'error'
  url?: string
  error?: string
}
export function useTunnelStatus(enabled = true) {
  const [tunnel, setTunnel] = useState<TunnelStatus>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const result = await api<TunnelStatus>('/connection/tunnel', undefined, 'GET', controller.signal)
        if (!controller.signal.aborted) { setTunnel(result); setError('') }
      } catch (error) {
        if (!controller.signal.aborted) setError(errorMessage(error))
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 2000)
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [enabled])
  return { tunnel, setTunnel, error, setError }
}
