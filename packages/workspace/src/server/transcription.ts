import type { FastifyInstance } from 'fastify'

export function transcriptionRoutes(app: FastifyInstance, openAIKey: () => string | undefined) {
  app.post('/api/speech/cloud', { bodyLimit: 16_384 }, async (req, reply) => {
    const { text, voice } = (req.body ?? {}) as { text?: unknown; voice?: unknown }
    if (typeof text !== 'string' || !text.trim() || text.length > 1600 || (voice !== 'marin' && voice !== 'cedar'))
      return reply.code(400).send({ error: 'invalid_speech_request' })
    const key = openAIKey()
    if (!key) return reply.code(503).send({ error: 'missing_key' })
    try {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', input: text, voice, response_format: 'mp3' }),
        redirect: 'error', signal: AbortSignal.timeout(60_000),
      })
      if (response.ok) return reply.header('Cache-Control', 'no-store').type('audio/mpeg').send(Buffer.from(await response.arrayBuffer()))
    } catch { /* Do not expose provider errors. */ }
    return reply.code(502).send({ error: 'speech_failed' })
  })
  const limit = 8 * 1024 * 1024
  for (const mime of ['audio/webm', 'audio/mp4']) {
    app.addContentTypeParser(mime, { parseAs: 'buffer', bodyLimit: limit }, (_req, body, done) => done(null, body))
  }
  app.post('/api/transcription/cloud', { bodyLimit: limit }, async (req, reply) => {
    const { language } = req.query as { language?: string }
    const mime = req.headers['content-type']?.split(';')[0]
    if (!(language === 'en' || language === 'es') ||
        !(mime === 'audio/webm' || mime === 'audio/mp4') || !Buffer.isBuffer(req.body) || !req.body.length)
      return reply.code(400).send({ error: 'invalid_audio' })
    const key = openAIKey()
    if (!key) return reply.code(503).send({ error: 'missing_key' })
    const form = new FormData()
    form.set('file', new Blob([new Uint8Array(req.body)], { type: mime }), mime === 'audio/mp4' ? 'audio.mp4' : 'audio.webm')
    form.set('model', 'gpt-4o-transcribe')
    form.set('language', language)
    try {
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', body: form, headers: key ? { Authorization: `Bearer ${key}` } : undefined,
        redirect: 'error', signal: AbortSignal.timeout(120_000),
      })
      if (response.ok) {
        const result = await response.json()
        if (typeof result?.text === 'string') return { text: result.text.trim() }
      }
    } catch { /* Do not expose provider errors. */ }
    return reply.code(502).send({ error: 'transcription_failed' })
  })
}
