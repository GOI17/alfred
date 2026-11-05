export type WorkspaceCommand = { id: string; label: string; run: () => void; disabled?: boolean }
type Registration = { command: () => WorkspaceCommand; available: () => boolean }

// Components own their commands and unregister on unmount. No document traversal,
// synthetic event objects or retained references to removed UI controls.
export class CommandRegistry {
  private entries = new Map<string, Registration>()
  register(id: string, registration: Registration) {
    this.entries.set(id, registration)
    return () => { if (this.entries.get(id) === registration) this.entries.delete(id) }
  }
  commands(): WorkspaceCommand[] {
    return Array.from(this.entries).filter(([, entry]) => entry.available()).map(([id, entry]) => {
      const command = entry.command()
      return { ...command, run: () => {
        // Recheck permissions/disabled state when executing, not just when opening.
        if (this.entries.get(id) !== entry || !entry.available()) return
        const current = entry.command()
        if (!current.disabled) current.run()
      } }
    })
  }
}
export const workspaceCommands = new CommandRegistry()
