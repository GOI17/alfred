import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'

export function layoutKey(projectId: string, workspacePath: string, part: string) {
  return `alfred.layout.v1:${JSON.stringify([projectId, workspacePath, part])}`
}

/** Save synchronously so a reload immediately after an interaction loses nothing. */
export function usePersistentLayout<T>(key: string, fallback: T, valid: (value: unknown) => value is T): [T, Dispatch<SetStateAction<T>>] {
  function read(): T {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) || 'null')
      return valid(value) ? value : fallback
    } catch { return fallback }
  }
  const [entry, setEntry] = useState(() => ({ key, value: read() }))
  let value = entry.value
  if (entry.key !== key) {
    value = read()
    setEntry({ key, value })
  }
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    // Reading storage also avoids stale values between rapid pointer events.
    const previous = read()
    const next = typeof update === 'function' ? (update as (previous: T) => T)(previous) : update
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Storage may be unavailable. */ }
    setEntry({ key, value: next })
  }, [key])
  return [value, setValue]
}

export const stringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')
export const point = (value: unknown): value is { x: number; y: number } => !!value && typeof value === 'object' && 'x' in value && 'y' in value && typeof value.x === 'number' && typeof value.y === 'number' && Number.isFinite(value.x) && Number.isFinite(value.y)
export const pointMap = (value: unknown): value is Record<string, { x: number; y: number }> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(point)
