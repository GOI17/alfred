import type { Conversation, Message } from '../shared/contracts.js'

// Adapter partials may be mutated in place. Only persisted, immutable histories
// are cached; each returned partial is detached from the adapter.
export class StreamProjection {
  private source?: Conversation[]
  private positions = new Map<string, number>()
  private histories = new WeakMap<Message[], Map<string, Message[]>>()

  conversations(source: Conversation[], partials: Record<string, Message>): Conversation[] {
    const entries = Object.entries(partials)
    if (!entries.length) {
      // Do not keep a completed/deleted chat alive through an idle index.
      this.source = undefined
      this.positions.clear()
      this.histories = new WeakMap()
      return source
    }
    if (source !== this.source) {
      this.source = source
      this.positions = new Map(source.map((item, index) => [item.id, index]))
    }
    let result: Conversation[] | undefined
    for (const [id, partial] of entries) {
      const index = this.positions.get(id)
      if (index === undefined) continue
      const item = source[index]
      let cached = this.histories.get(item.messages)
      if (!cached) { cached = new Map(); this.histories.set(item.messages, cached) }
      let history = cached.get(partial.id)
      if (!history) {
        history = item.messages.filter(message => message.id !== partial.id)
        // Bound retained histories if an adapter rotates IDs without persisting.
        cached.clear(); cached.set(partial.id, history)
      }
      result ??= source.slice()
      result[index] = { ...item, messages: [...history, JSON.parse(JSON.stringify(partial)) as Message] }
    }
    return result ?? source
  }
}
