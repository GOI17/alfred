type ConnectionCode = { code: string; error?: never } | { code?: never; error: 'invalid' | 'different-server' }

/** Read credentials locally; a scanned link must never navigate or select the auth server. */
export function readConnectionCode(input: string, origin: string, linkOnly = false): ConnectionCode {
  const value = input.trim()
  if (linkOnly || /^[a-z][a-z\d+.-]*:|^\/\//i.test(value)) {
    let url: URL
    try { url = new URL(value) } catch { return { error: 'invalid' } }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return { error: 'invalid' }
    if (url.origin !== origin) return { error: 'different-server' }
    const codes = new URLSearchParams(url.hash.slice(1)).getAll('connectionCode')
    if (codes.length !== 1 || !codes[0].trim() || codes[0].length > 200) return { error: 'invalid' }
    return { code: codes[0] }
  }
  if (!value || value.length > 200) return { error: 'invalid' }
  return { code: value }
}
