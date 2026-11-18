import Fastify from 'fastify'
import { afterEach, expect, it, vi } from 'vitest'
import { transcriptionRoutes } from '../src/server/transcription.js'

const app = Fastify()
const key = vi.fn<() => string | undefined>()
transcriptionRoutes(app, key)
const record = (mode: string) => app.inject({ method: 'POST', url: `/api/transcription/${mode}?language=es`, headers: { 'content-type': 'audio/webm' }, payload: Buffer.from('mock audio') })
afterEach(() => { key.mockReset(); vi.unstubAllGlobals() })

it('does not forward local recordings or contact OpenAI without credentials', async () => {
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  expect((await record('local')).statusCode).toBe(404)
  expect((await record('cloud')).json()).toEqual({ error: 'missing_key' })
  expect(fetch).not.toHaveBeenCalled()
})

it('uses the current credential without restarting the server', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ text: ' hola ' }))
  vi.stubGlobal('fetch', fetch)
  key.mockReturnValue('example')
  expect((await record('cloud')).json()).toEqual({ text: 'hola' })
  expect(fetch).toHaveBeenCalledWith('https://api.openai.com/v1/audio/transcriptions', expect.objectContaining({ headers: { Authorization: 'Bearer example' } }))
  expect(fetch.mock.calls[0][1].body.get('model')).toBe('gpt-4o-transcribe')
})

it('only synthesizes valid cloud requests with a configured key', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('sample'))
  vi.stubGlobal('fetch', fetch)
  const speak = (voice: string) => app.inject({ method: 'POST', url: '/api/speech/cloud', payload: { voice, text: 'Hola' } })
  expect((await speak('device:example')).statusCode).toBe(400)
  expect((await speak('marin')).statusCode).toBe(503)
  expect(fetch).not.toHaveBeenCalled()
  key.mockReturnValue('example')
  const audio = await speak('cedar')
  expect(audio.statusCode).toBe(200)
  expect(audio.headers['content-type']).toContain('audio/mpeg')
  expect(audio.body).toBe('sample')
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject({ input: 'Hola', voice: 'cedar', model: 'gpt-4o-mini-tts' })
})
