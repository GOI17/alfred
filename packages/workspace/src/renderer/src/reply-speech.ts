// Both previews and /voice use this player; cancellation never advances the turn.
export function playSpeech(text: string, language: string, voice: string, ended: () => void, failed: (missingKey: boolean) => void) {
  const controller = new AbortController()
  let audio: HTMLAudioElement | undefined
  let url: string | undefined
  let utterance: SpeechSynthesisUtterance | undefined
  function clearAudio() {
    if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = undefined }
    if (url) { URL.revokeObjectURL(url); url = undefined }
  }
  async function start() {
    if (!voice.startsWith('openai:')) {
      utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = language
      const selected = window.speechSynthesis.getVoices().find(v => `device:${v.voiceURI}` === voice && v.lang.toLowerCase().split(/[-_]/)[0] === language)
      if (selected) { utterance.voice = selected; utterance.lang = selected.lang }
      utterance.onend = ended
      utterance.onerror = () => failed(false)
      window.speechSynthesis.speak(utterance)
      return
    }
    let remaining = text.trim()
    async function next() {
      clearAudio()
      if (controller.signal.aborted) return
      if (!remaining) { ended(); return }
      let length = Math.min(remaining.length, 1600)
      if (length < remaining.length) {
        const space = remaining.lastIndexOf(' ', length)
        if (space > 0) length = space
        else if (/[\uD800-\uDBFF]/.test(remaining[length - 1])) length--
      }
      const response = await fetch('/api/speech/cloud', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: remaining.slice(0, length), voice: voice.slice(7) }), signal: controller.signal })
      remaining = remaining.slice(length).trimStart()
      if (!response.ok) { if (!controller.signal.aborted) failed(response.status === 503); return }
      const blob = await response.blob()
      if (controller.signal.aborted) return
      url = URL.createObjectURL(blob)
      audio = new Audio(url)
      audio.onended = () => { void next().catch(onError) }
      audio.onerror = onError
      await audio.play()
    }
    await next()
  }
  function onError() { clearAudio(); if (!controller.signal.aborted) failed(false) }
  void start().catch(onError)
  return () => {
    controller.abort(); clearAudio()
    if (utterance) { utterance.onend = utterance.onerror = null; window.speechSynthesis.cancel() }
  }
}
