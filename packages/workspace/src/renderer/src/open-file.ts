export type FileRequest = { conversationId: string; path: string }
const eventName = 'alfred:open-file'

/** All workspace file entry points use the same viewer in their client window. */
export function openWorkspaceFile(conversationId: string, path: string) {
  window.dispatchEvent(new CustomEvent<FileRequest>(eventName, { detail: { conversationId, path } }))
}

export function onOpenWorkspaceFile(open: (request: FileRequest) => void) {
  const listener = (event: Event) => open((event as CustomEvent<FileRequest>).detail)
  window.addEventListener(eventName, listener)
  return () => window.removeEventListener(eventName, listener)
}
