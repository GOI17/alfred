import { attachmentsSchema, MAX_ATTACHMENT_BYTES, MAX_TOTAL_ATTACHMENT_BYTES, attachmentMediaType, type Attachment } from '../shared/attachments.js'

export function validateAttachments(input: unknown): Attachment[] {
  const attachments = attachmentsSchema.parse(input)
  let total = 0
  for (const file of attachments) {
    attachmentMediaType(file.name, file.mediaType)
    const bytes = Buffer.from(file.data, 'base64')
    if (!bytes.length || bytes.toString('base64') !== file.data)
      throw new Error(`Empty or invalid attachment: ${file.name}`)
    total += bytes.length
    if (bytes.length > MAX_ATTACHMENT_BYTES || total > MAX_TOTAL_ATTACHMENT_BYTES)
      throw new Error('Maximum 2 MB per file and 4 MB per message.')
    const valid = file.mediaType === 'text/plain'
      ? !bytes.includes(0) && (() => { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return true } catch { return false } })()
      : file.mediaType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : file.mediaType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : file.mediaType === 'image/gif' ? /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
    if (!valid) throw new Error(`Contenido no compatible: ${file.name}`)
  }
  return attachments
}
