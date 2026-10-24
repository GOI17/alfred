// Only local path links are revealable. Web URLs and other protocols keep
// their normal Markdown handling (including its unsafe-protocol filtering).
export function fileLinkPath(href: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('?') || href.startsWith('//')) return null
  let path = href
  if (/^file:/i.test(path)) {
    try {
      const url = new URL(path)
      if (url.hostname && url.hostname !== 'localhost') return null
      path = url.pathname
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1)
    } catch { return null }
  } else {
    if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return null
    path = path.split(/[?#]/, 1)[0]
  }
  try { path = decodeURIComponent(path) } catch { return null }
  path = path.replace(/:\d+(?::\d+)?$/, '')
  return path && !/[\x00-\x1f]/.test(path) ? path : null
}
