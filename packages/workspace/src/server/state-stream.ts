import { stateDelta } from '../shared/state-delta.js'

// Shared by all subscribers. Only the latest transition is retained; slow clients
// receive a snapshot rather than an unbounded queue of patches.
export class StateStream {
  private dirty = true
  private revision = 0
  private previous: unknown
  private snapshot = ''
  private patch = ''
  private snapshotRevision = 0
  constructor(private readonly read: () => unknown, private readonly immutable = false) {}
  invalidate() { this.dirty = true }
  frame(since?: number) {
    if (this.dirty) {
      const value = this.read()
      const next = this.immutable ? value : JSON.parse(JSON.stringify(value))
      const base = this.revision
      const delta = this.previous === undefined ? undefined : stateDelta(this.previous, next)
      this.revision++
      this.patch = delta ? `id: ${this.revision}\nevent: patch\ndata: ${JSON.stringify({ base, revision: this.revision, delta })}\n\n` : ''
      // Empty changes still need a revision acknowledgement.
      if (!delta && base) this.patch = `id: ${this.revision}\nevent: patch\ndata: ${JSON.stringify({ base, revision: this.revision })}\n\n`
      this.previous = next
      this.dirty = false
    }
    if (since === this.revision - 1 && this.patch && this.patch.length < this.snapshot.length)
      return { revision: this.revision, data: this.patch }
    if (this.snapshotRevision !== this.revision) {
      this.snapshot = `id: ${this.revision}\nevent: state\ndata: ${JSON.stringify(this.previous)}\n\n`
      this.snapshotRevision = this.revision
    }
    return { revision: this.revision, data: this.snapshot }
  }
}
