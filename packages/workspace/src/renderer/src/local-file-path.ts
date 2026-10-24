export function localFilePath(href: string): string | null {
  if (!href || href.startsWith('#') || href.startsWith('//')) return null
  try {
    let path: string
    if (/^file:/i.test(href)) {
      const url = new URL(href)
      if (url.hostname && url.hostname !== 'localhost') return null
      path = decodeURIComponent(url.pathname)
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1)
    } else {
      if (/^[a-z][a-z\d+.-]*:/i.test(href) && !/^[a-z]:[\\/]/i.test(href)) return null
      path = decodeURIComponent(href.split(/[?#]/)[0])
    }
    path = path.replace(/:\d+(?::\d+)?$/, '')
    return path && ![...path].some((character) => character.charCodeAt(0) < 32) ? path : null
  } catch { return null }
}
