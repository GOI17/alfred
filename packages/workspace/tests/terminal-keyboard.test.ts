import { describe, expect, it } from 'vitest'
import { terminalWordNavigation } from '../src/renderer/src/terminal-keyboard'

const event = {
  type: 'keydown', key: 'ArrowLeft', altKey: true,
  ctrlKey: false, metaKey: false, shiftKey: false, isComposing: false,
}

describe('terminal macOS word navigation', () => {
  it('maps Option arrows to backward/forward word, including repeats', () => {
    expect(terminalWordNavigation(event, 'MacIntel')).toBe('\u001bb')
    expect(terminalWordNavigation({ ...event, key: 'ArrowRight' }, 'MacIntel')).toBe('\u001bf')
    expect(terminalWordNavigation(event, 'MacIntel')).toBe('\u001bb')
  })
  it('leaves other platforms and normal text to xterm', () => {
    for (const platform of ['Linux x86_64', 'Win32']) {
      expect(terminalWordNavigation(event, platform)).toBeUndefined()
    }
    for (const patch of [
      { type: 'keyup' }, { type: 'keypress' }, { altKey: false },
      { ctrlKey: true }, { metaKey: true }, { shiftKey: true },
      { isComposing: true }, { key: 'ArrowUp' }, { key: 'ArrowDown' }, { key: 'a' },
    ]) {
      expect(terminalWordNavigation({ ...event, ...patch }, 'MacIntel')).toBeUndefined()
    }
  })
})
