import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { databaseSchema, type Database } from '../shared/contracts.js'

export class Store {
  private tail: Promise<unknown> = Promise.resolve()
  private data: Database = {
    version: 1,
    projects: [],
    conversations: [],
    providers: [],
    chatgptAccounts: [],
  }
  constructor(readonly directory: string) {}
  async open() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      this.data = databaseSchema.parse(
        JSON.parse(await readFile(join(this.directory, 'workspace.json'), 'utf8')),
      )
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    return this
  }
  get() {
    return structuredClone(this.data)
  }
  update<T>(change: (data: Database) => T | Promise<T>): Promise<T> {
    const operation = this.tail.then(async () => {
      const next = structuredClone(this.data)
      const result = await change(next)
      databaseSchema.parse(next)
      const temporary = join(this.directory, `workspace.${randomUUID()}.tmp`)
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 })
      await rename(temporary, join(this.directory, 'workspace.json'))
      this.data = next
      return result
    })
    this.tail = operation.catch(() => {})
    return operation
  }
}
