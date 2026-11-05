import { afterEach, expect, test, vi } from 'vitest'
import { onOpenWorkspaceFile, openWorkspaceFile } from '../src/renderer/src/open-file'

afterEach(() => vi.unstubAllGlobals())

test('routes repeated file requests with their original conversation and cleans up', () => {
  vi.stubGlobal('window', new EventTarget())
  const open = vi.fn()
  const unsubscribe = onOpenWorkspaceFile(open)
  openWorkspaceFile('floating-chat', 'src/index.ts')
  openWorkspaceFile('floating-chat', 'src/index.ts')
  expect(open).toHaveBeenCalledTimes(2)
  expect(open).toHaveBeenLastCalledWith({ conversationId: 'floating-chat', path: 'src/index.ts' })
  unsubscribe()
  openWorkspaceFile('other-chat', 'README.md')
  expect(open).toHaveBeenCalledTimes(2)
})
