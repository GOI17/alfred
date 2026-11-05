import { expect, test } from 'vitest'
import { CommandRegistry } from '../src/renderer/src/command-registry'

test('commands use current guards and disappear on unmount', () => {
  const registry = new CommandRegistry()
  let disabled = false, calls = 0, mounted = true
  const unregister = registry.register('test', {
    available: () => mounted,
    command: () => ({ id: 'test', label: 'Test', disabled, run: () => { calls++ } }),
  })
  const command = registry.commands()[0]
  disabled = true; command.run(); expect(calls).toBe(0)
  disabled = false; command.run(); expect(calls).toBe(1)
  mounted = false; command.run(); expect(calls).toBe(1)
  unregister(); expect(registry.commands()).toEqual([])
})
test('cleanup cannot unregister a replacement with the same id', () => {
  const registry = new CommandRegistry()
  const registration = { available: () => true, command: () => ({ id: 'a', label: 'A', run() {} }) }
  const remove = registry.register('a', registration)
  registry.register('a', { ...registration })
  remove()
  expect(registry.commands()).toHaveLength(1)
})

test('a command captured before unregistration cannot execute', () => {
  const registry = new CommandRegistry()
  let calls = 0
  const remove = registry.register('a', { available: () => true, command: () => ({ id: 'a', label: 'A', run: () => { calls++ } }) })
  const command = registry.commands()[0]
  remove(); command.run()
  expect(calls).toBe(0)
})
