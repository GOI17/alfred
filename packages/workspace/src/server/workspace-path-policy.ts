// Apply the same conservative policy on every OS, including case-insensitive
// filesystems and Windows aliases (trailing dots/spaces and alternate streams).
const privateNames = new Set([
  '.git', 'node_modules', '.env', '.ssh', '.aws', '.npmrc', '.netrc', '.pypirc',
  '.alfred', '.alfred-workspace',
])

export function privatePath(path: string): boolean {
  return path.split(/[\\/]/).some((part) => {
    if (/[\x00-\x1f:]/.test(part)) return true
    const name = part.toLowerCase().replace(/[. ]+$/, '')
    return privateNames.has(name) || name.startsWith('.env.') || /\.(pem|key)$/.test(name)
  })
}
