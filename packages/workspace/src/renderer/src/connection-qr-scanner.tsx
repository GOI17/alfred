import { useEffect, useEffectEvent, useState } from 'react'
import { Button } from './components/ui/button'
import { Dialog } from './components/ui/dialog'
import { useUI } from './ui-preferences'

export function ConnectionQrScanner({ onRead, onClose, onError }: {
  onRead: (value: string) => void
  onClose: () => void
  onError: (message: string) => void
}) {
  const { t } = useUI()
  // The dialog portal mounts its video after this component's first render.
  const [video, setVideo] = useState<HTMLVideoElement | null>(null)
  const read = useEffectEvent(onRead)
  const close = useEffectEvent(onClose)
  const fail = useEffectEvent(() => onError(t(
    'Could not use the camera. Allow camera access over HTTPS, or paste the connection code or link instead.',
    'No se pudo usar la cámara. Permite el acceso a la cámara usando HTTPS, o pega el código o enlace de conexión.',
  )))
  useEffect(() => {
    if (!video) return
    let disposed = false
    let stream: MediaStream | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      disposed = true
      clearTimeout(timer)
      stream?.getTracks().forEach((track) => track.stop())
      video.srcObject = null
    }
    const hide = () => {
      if (document.hidden) { stop(); close() }
    }
    const leave = () => { stop(); close() }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', leave)
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable')
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' } } })
        // Permission can be granted after the user has closed the scanner.
        if (disposed) { stream.getTracks().forEach((track) => track.stop()); return }
        stream.getVideoTracks().forEach((track) => track.addEventListener('ended', () => {
          if (!disposed) { stop(); fail() }
        }, { once: true }))
        video.srcObject = stream
        await video.play()
        const { default: jsQR } = await import('jsqr')
        if (disposed) return
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('Camera preview unavailable')
        const scan = () => {
          if (disposed) return
          try {
            if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
              const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight))
              canvas.width = Math.round(video.videoWidth * scale)
              canvas.height = Math.round(video.videoHeight * scale)
              context.drawImage(video, 0, 0, canvas.width, canvas.height)
              const frame = context.getImageData(0, 0, canvas.width, canvas.height)
              const qr = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })
              if (qr) { stop(); read(qr.data); return }
            }
            timer = setTimeout(scan, 200)
          } catch { stop(); fail() }
        }
        scan()
      } catch {
        if (!disposed) { stop(); fail() }
      }
    })()
    return () => {
      stop()
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('pagehide', leave)
    }
  }, [video])
  return <Dialog open onClose={onClose} title={t('Scan QR', 'Escanear QR')}
    description={t('Point your camera at the QR shown in Connect phone on your computer.', 'Apunta la cámara al QR de Conectar teléfono en tu computadora.')}>
    <video className="connection-camera" ref={setVideo} autoPlay muted playsInline aria-label={t('Camera preview', 'Vista de la cámara')} />
    <p className="field-note">{t('The code is read on this device. Camera images are not uploaded.', 'El código se lee en este dispositivo. Las imágenes de la cámara no se suben al servidor.')}</p>
    <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>{t('Cancel', 'Cancelar')}</Button></div>
  </Dialog>
}
