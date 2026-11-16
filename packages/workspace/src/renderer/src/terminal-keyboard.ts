// Translate macOS word navigation without changing Option-based text entry.
export function terminalWordNavigation(
  event: Pick<KeyboardEvent, 'type' | 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'isComposing'>,
  platform: string,
): string | undefined {
  if (
    !/Mac/.test(platform) || event.type !== 'keydown' || !event.altKey ||
    event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing
  ) return undefined
  if (event.key === 'ArrowLeft') return '\u001bb'
  if (event.key === 'ArrowRight') return '\u001bf'
  return undefined
}
