// A tree patch copies each changed ancestor once, retaining untouched references.
// Inputs are JSON wire values (no undefined properties or class instances).
export type StateDelta = { value: unknown } | { append: string } | { fields: Record<string, StateDelta>; removed: string[]; length?: number }

export function stateDelta(before: unknown, after: unknown): StateDelta | undefined {
  if (Object.is(before, after)) return
  if (typeof before === 'string' && typeof after === 'string' && after.startsWith(before) && before.length > 32) return { append: after.slice(before.length) }
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object' ||
      Array.isArray(before) !== Array.isArray(after)) return { value: after }
  // Wire arrays are dense. Avoid allocating two arrays of string keys and
  // recursively visiting unchanged entries on every streaming update.
  if (Array.isArray(before) && Array.isArray(after)) {
    const fields: Record<string, StateDelta> = Object.create(null)
    let changed = before.length !== after.length
    for (let index = 0; index < after.length; index++) {
      if (index < before.length && Object.is(before[index], after[index])) continue
      const change = index < before.length ? stateDelta(before[index], after[index]) : { value: after[index] }
      if (change) { fields[index] = change; changed = true }
    }
    if (changed) return { fields, removed: [], length: after.length }
    return
  }
  const left = before as Record<string, unknown>
  const right = after as Record<string, unknown>
  const fields: Record<string, StateDelta> = Object.create(null)
  const removed = Object.keys(left).filter(key => !Object.hasOwn(right, key))
  for (const key of Object.keys(right)) {
    const change = Object.hasOwn(left, key) ? stateDelta(left[key], right[key]) : { value: right[key] }
    if (change) fields[key] = change
  }
  if (removed.length || Object.keys(fields).length) return { fields, removed, ...(Array.isArray(after) ? { length: after.length } : {}) }
}

export function applyStateDelta<T>(before: T, delta: StateDelta): T {
  if ('value' in delta) return delta.value as T
  if ('append' in delta) return ((before as string) + delta.append) as T
  const next = (Array.isArray(before) ? [...before] : { ...before }) as Record<string, unknown>
  for (const key of delta.removed) delete next[key]
  for (const [key, change] of Object.entries(delta.fields)) {
    // Define own properties instead of invoking prototype setters.
    Object.defineProperty(next, key, { value: applyStateDelta(next[key], change), enumerable: true, configurable: true, writable: true })
  }
  if (Array.isArray(next) && delta.length !== undefined) next.length = delta.length
  return next as T
}
