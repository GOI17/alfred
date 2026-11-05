// JSON-compatible storage values only (plain objects/arrays, no custom toJSON).
// Bound serialization work between asynchronous writes, rather than blocking on
// one JSON.stringify of the entire database. A single large string remains atomic.
export function* jsonChunks(value: unknown, targetSize = 64 * 1024): Generator<string> {
  let chunk = ''
  function* tokens(item: unknown): Generator<string> {
    if (Array.isArray(item)) {
      yield '['
      for (let i = 0; i < item.length; i++) {
        if (i) yield ','
        yield* tokens(item[i] === undefined ? null : item[i])
      }
      yield ']'
    } else if (item !== null && typeof item === 'object') {
      yield '{'
      let first = true
      for (const [key, child] of Object.entries(item)) {
        if (child === undefined) continue
        if (!first) yield ','
        first = false
        yield JSON.stringify(key); yield ':'; yield* tokens(child)
      }
      yield '}'
    } else {
      yield JSON.stringify(item) ?? 'null'
    }
  }
  for (const token of tokens(value)) {
    chunk += token
    if (chunk.length >= targetSize) { yield chunk; chunk = '' }
  }
  if (chunk) yield chunk
}
