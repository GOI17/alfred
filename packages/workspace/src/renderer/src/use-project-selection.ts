import { useEffect, useRef, useState } from 'react'
import type { Project } from '../../shared/contracts'
import { api, errorMessage } from './api'

export function useProjectSelection(
  onAdded: (project: Project) => Promise<void>,
  onError: (error: string) => void,
) {
  const pending = useRef<AbortController>(undefined)
  const [selecting, setSelecting] = useState(false)
  useEffect(
    () => () => {
      pending.current?.abort()
      pending.current = undefined
    },
    [],
  )
  async function select() {
    if (pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setSelecting(true)
    onError('')
    try {
      const result = await api<{ project: Project | null }>(
        '/projects/pick',
        {},
        'POST',
        controller.signal,
      )
      if (result.project) await onAdded(result.project)
    } catch (error) {
      if (!controller.signal.aborted) onError(errorMessage(error))
    } finally {
      if (pending.current === controller) {
        pending.current = undefined
        setSelecting(false)
      }
    }
  }
  return { selecting, select }
}
