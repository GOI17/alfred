import { expect, it } from 'vitest'
import { conversationResources } from '../src/renderer/src/conversation-resources'
import type { Message } from '../src/shared/contracts'

function message(role: Message['role'], text: string): Message {
  return { id: role, role, text, notes: [], createdAt: '2026-10-20T12:00:00Z' }
}

it('collects shared outputs and sources without treating user files as generated outputs', () => {
  const result = conversationResources([
    message('user', '[Requirements](docs/brief.md) and https://github.com/example/project.'),
    message('assistant', '[Report](<reports/Final report.md:12>) and [Source](https://example.com/guide)'),
    message('assistant', '[Report](<reports/Final report.md:12>)'),
  ])
  expect(result.outputs).toEqual([{ kind: 'file', target: 'reports/Final report.md', name: 'Report' }])
  expect(result.sources.map((source) => source.target)).toEqual(['docs/brief.md', 'https://github.com/example/project', 'https://example.com/guide'])
})

it('ignores unsafe URLs, credentials, fragments and links inside code examples', () => {
  const result = conversationResources([message('assistant', [
    '[bad](javascript:alert(1)) [bad](data:text/html,hello) [private](https://user:secret@example.com/path)',
    '[anchor](#heading) [bad](//example.com) [bad](file://other-host/private) [bad](some%00file)',
    '`[example](not-an-output.md)`',
    '```md\n[example](example.md) https://example.com/code\n```',
    '~~~md\n[still streaming](partial.md) https://example.com/partial',
  ].join('\n'))])
  expect(result).toEqual({ outputs: [], sources: [] })
})
