import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function loadSecret(directory: string, name: string, length = 32) {
  const path = join(directory, name)
  try {
    return await readFile(path)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    const key = randomBytes(length)
    try {
      await writeFile(path, key, { mode: 0o600, flag: 'wx' })
      return key
    } catch (race) {
      if (race instanceof Error && 'code' in race && race.code === 'EEXIST') return readFile(path)
      throw race
    }
  }
}
export class Vault {
  constructor(private key: Buffer) {}
  encrypt(value: string) {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', this.key, iv)
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')
  }
  decrypt(value: string) {
    const data = Buffer.from(value, 'base64')
    const cipher = createDecipheriv('aes-256-gcm', this.key, data.subarray(0, 12))
    cipher.setAuthTag(data.subarray(12, 28))
    return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8')
  }
}
