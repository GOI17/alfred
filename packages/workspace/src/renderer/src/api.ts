export async function api<T>(
  path: string,
  body?: unknown,
  method?: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  const data = await response.json()
  if (!response.ok)
    throw new Error(
      typeof data.error === 'string' ? data.error : 'The operation could not be completed.',
    )
  return data
}
export function socketUrl(path: string) {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api${path}`
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The operation could not be completed.'
}
