import { z } from 'zod'

export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024
export const MAX_ATTACHMENTS = 4
export const MAX_TOTAL_ATTACHMENT_BYTES = 4 * 1024 * 1024
export const attachmentSchema = z.object({
  name: z.string().min(1).max(255),
  mediaType: z.enum(['text/plain', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  data: z.string().max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4),
})
export type Attachment = z.infer<typeof attachmentSchema>
export const attachmentsSchema = z.array(attachmentSchema).max(MAX_ATTACHMENTS)

export function attachmentMediaType(name: string, mime: string): Attachment['mediaType'] {
  if (/^(\.env($|\.)|.*\.(pem|key|p12|pfx)$)/i.test(name))
    throw new Error('Do not attach secret or credential files.')
  const extension = name.split('.').pop()?.toLowerCase() || ''
  const images: Record<string, Attachment['mediaType']> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  }
  if (images[extension]) return images[extension]
  if (mime.startsWith('text/') || /^(txt|md|mdx|csv|json|jsonl|xml|yaml|yml|toml|ini|log|js|jsx|ts|tsx|css|scss|html|py|rb|go|rs|java|c|h|cpp|hpp|cs|sql|sh|vue|svelte)$/.test(extension))
    return 'text/plain'
  throw new Error(`Unsupported format: ${name}. Use images or text/code files.`)
}
