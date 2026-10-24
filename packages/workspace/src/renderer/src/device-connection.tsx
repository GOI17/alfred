import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { ArrowUpRight, ScanQrCode, Copy } from 'lucide-react'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import { Dialog } from './components/ui/dialog'
import { useUI } from './ui-preferences'
import { readConnectionCode } from './connection-code'
import { ConnectionQrScanner } from './connection-qr-scanner'

export function Login({ connected }: { connected: () => Promise<void> }) {
  const { t } = useUI()
  const [code, setCode] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [fromLink, setFromLink] = useState(false)
  const [copied, setCopied] = useState(false)
  const [scanned, setScanned] = useState(false)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && navigator.standalone === true)
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1))
    const incoming = params.get('connectionCode')
    if (!incoming) return
    setCode(incoming)
    setFromLink(true)
    params.delete('connectionCode')
    const hash = params.toString()
    window.history.replaceState(null, '', window.location.pathname + window.location.search + (hash ? '#' + hash : ''))
  }, [])
  function parse(value: string, linkOnly = false) {
    const result = readConnectionCode(value, window.location.origin, linkOnly)
    if (result.error) {
      setError(result.error === 'different-server'
        ? t('This link belongs to another server. Open Alfred installed from the same address shown on your computer.', 'Este enlace pertenece a otro servidor. Abre Alfred instalado desde la misma dirección que muestra tu computadora.')
        : t('Use an Alfred connection QR, or paste a valid connection code or link.', 'Usa un QR de conexión de Alfred, o pega un código o enlace de conexión válido.'))
      return
    }
    setError('')
    return result.code
  }
  return (
    <div className="login-screen">
      <div className="login-card">
        <span className="brand-mark">a·</span>
        <p className="eyebrow">{t('YOUR WORKSPACE, WITH YOU', 'TU WORKSPACE, CONTIGO')}</p>
        <h1>{t('Welcome back.', 'Te damos la bienvenida.')}</h1>
        <p>{t('Scan the QR from Connect phone on your computer, or enter the server code.', 'Escanea el QR de Conectar teléfono en tu computadora, o introduce el código del servidor.')}</p>
        <div className="login-scan"><Button variant="secondary" disabled={busy} onClick={() => { setError(''); setScanning(true) }}>
          <ScanQrCode size={18} />{t('Scan QR', 'Escanear QR')}
        </Button></div>
        {!standalone && !fromLink && <p className="field-note">{t('To connect the installed app, open Alfred from your Home Screen and scan the QR there.', 'Para conectar la app instalada, abre Alfred desde la pantalla de inicio y escanea el QR allí.')}</p>}
        {fromLink && !standalone && <div className="connection-handoff">
          <p>{t('Already opened the QR in your browser? Copy the code, open Alfred from your Home Screen, and paste it to connect there. The code works once and expires after 5 minutes.', '¿Ya abriste el QR en el navegador? Copia el código, abre Alfred desde la pantalla de inicio y pégalo para conectar allí. El código funciona una vez y caduca a los 5 minutos.')}</p>
          <Button variant="secondary" disabled={busy} onClick={async () => {
            const parsed = parse(code)
            if (!parsed) return
            try { await navigator.clipboard.writeText(parsed); setCopied(true) }
            catch { setError(t('Could not copy. Open Alfred from your Home Screen and use Scan QR.', 'No se pudo copiar. Abre Alfred desde la pantalla de inicio y usa Escanear QR.')) }
          }}><Copy size={16} />{copied ? t('Code copied', 'Código copiado') : t('Copy connection code', 'Copiar código de conexión')}</Button>
        </div>}
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const parsed = parse(code)
            if (!parsed) return
            setBusy(true)
            try {
              await api('/auth', { code: parsed })
              await connected()
            } catch (error) {
              setError(errorMessage(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          <label>
            {t('Connection code', 'Código de conexión')}
            <Input
              required
              type="password"
              value={code}
              onChange={(event) => { setCode(event.target.value); setCopied(false); setScanned(false) }}
              placeholder={t('Code or connection link', 'Código o enlace de conexión')}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-describedby="connection-code-help"
            />
          </label>
          <p id="connection-code-help" className="field-note">{t('You can also paste the link copied from the QR.', 'También puedes pegar el enlace copiado del QR.')}</p>
          {scanned && <p role="status">{t('QR ready. Tap Enter my workspace to connect.', 'QR listo. Pulsa Entrar a mi workspace para conectar.')}</p>}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {busy ? t('Connecting…', 'Conectando…') : t('Enter my workspace', 'Entrar a mi workspace')}
            <ArrowUpRight size={16} />
          </Button>
        </form>
        {scanning && <ConnectionQrScanner onClose={() => setScanning(false)} onError={(message) => { setScanning(false); setError(message) }} onRead={(value) => {
          setScanning(false)
          const parsed = parse(value, true)
          if (parsed) { setCode(parsed); setScanned(true); setCopied(false) }
        }} />}
      </div>
    </div>
  )
}
type TunnelStatus = {
  state: 'disabled' | 'stopped' | 'connecting' | 'connected' | 'stopping' | 'error'
  url?: string
  error?: string
}
export function useTunnelStatus(enabled = true) {
  const [tunnel, setTunnel] = useState<TunnelStatus>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const result = await api<TunnelStatus>('/connection/tunnel', undefined, 'GET', controller.signal)
        if (!controller.signal.aborted) { setTunnel(result); setError('') }
      } catch (error) {
        if (!controller.signal.aborted) setError(errorMessage(error))
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 2000)
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [enabled])
  return { tunnel, setTunnel, error, setError }
}
export function PhoneDialog({ onClose }: { onClose: () => void }) {
  const { t } = useUI()
  const { tunnel, setTunnel, error, setError } = useTunnelStatus()
  const [busy, setBusy] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const [pairing, setPairing] = useState<{ url: string; expiresAt: number }>()
  const [pairingError, setPairingError] = useState('')
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    setPairing(undefined)
    setPairingError('')
    if (tunnel?.state !== 'connected') return
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    void api<{ url: string; expiresAt: number }>('/connection/pairing', {}, 'POST', controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return
        setPairing(result)
        timer = setTimeout(() => setPairing(undefined), Math.max(0, result.expiresAt - Date.now()))
      })
      .catch((error) => { if (!controller.signal.aborted) setPairingError(errorMessage(error)) })
    return () => { controller.abort(); clearTimeout(timer) }
  }, [tunnel?.state, generation])
  async function change(connect: boolean) {
    setBusy(true)
    setError('')
    try {
      setTunnel(await api<TunnelStatus>('/connection/tunnel', connect ? { confirmed: true } : undefined, connect ? 'POST' : 'DELETE'))
    } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const labels = { disabled: 'Not configured', stopped: 'Disconnected', connecting: 'Connecting…', connected: 'Connected', stopping: 'Disconnecting…', error: 'Error' }
  return (
    <Dialog open onClose={onClose} title="Your workspace on your phone"
      description="HTTPS access from any network through Cloudflare Tunnel.">
      <p role="status">{tunnel ? labels[tunnel.state] : 'Checking connection…'}</p>
      {tunnel?.state === 'disabled' ? (
        <p>Install cloudflared and configure ALFRED_PUBLIC_ORIGIN, ALFRED_CLOUDFLARE_TUNNEL, and ALFRED_CLOUDFLARE_CONFIG on the server. See the Cloudflare guide in docs.</p>
      ) : tunnel && (
        <>
          {tunnel.url && <p><a className="text-link" href={tunnel.url} target="_blank" rel="noreferrer">{tunnel.url}</a></p>}
          {tunnel.state === 'connected' && (
            <section aria-label="Pair your phone" style={{ display: 'grid', justifyItems: 'center', gap: 12 }}>
              {pairing ? <>
                <div style={{ background: '#fff', padding: 16, borderRadius: 12 }}>
                  <QRCodeSVG value={pairing.url} size={208} marginSize={2} title="Scan to connect to Alfred" />
                </div>
                <p className="field-note">{t('Installed Alfred? Open it from your Home Screen, tap Scan QR on the welcome screen, then Enter my workspace. This connects inside the installed app.', '¿Ya instalaste Alfred? Ábrelo desde la pantalla de inicio, pulsa Escanear QR en la pantalla de bienvenida y después Entrar a mi workspace. Así conectas dentro de la app instalada.')}</p>
                <p className="field-note">{t('Scanning with the iPhone Camera opens the browser. You can copy the code there and paste it in Alfred instead. This QR expires in 5 minutes and works once. Do not share it.', 'Escanear con la Cámara del iPhone abre el navegador. Desde allí puedes copiar el código y pegarlo en Alfred. Este QR caduca a los 5 minutos y funciona una vez. No lo compartas.')}</p>
              </> : <p role="status">Generate a new QR if it expired or was already used.</p>}
              {pairingError && <p className="error-text" role="alert">{pairingError}</p>}
              <Button variant="secondary" onClick={() => setGeneration((value) => value + 1)}>Generate new QR</Button>
            </section>
          )}
          <p className="field-note">The computer must remain on. Sign in on your phone with the Alfred code. Closing this dialog does not disconnect the tunnel.</p>
          {['stopped', 'error'].includes(tunnel.state) && (
            <label style={{ gridTemplateColumns: '20px minmax(0, 1fr)', alignItems: 'start', gap: '10px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(event) => setConfirmed(event.target.checked)}
                style={{ width: '20px', height: '20px', margin: '2px 0 0', accentColor: 'var(--primary)' }}
              />
              <span>I authorize publishing Alfred through Cloudflare. Traffic passes through Cloudflare; access still requires authentication.</span>
            </label>
          )}
          <div className="dialog-actions">
            {['stopped', 'error'].includes(tunnel.state) && <Button disabled={busy || !confirmed || !['stopped', 'error'].includes(tunnel.state)} onClick={() => void change(true)}>Connect phone</Button>}
            <Button variant="secondary" disabled={busy || ['stopped', 'stopping'].includes(tunnel.state)} onClick={() => void change(false)}>Disconnect</Button>
          </div>
          <p className="field-note">If the connection fails, disconnect before trying again. Disconnecting from your phone will end remote access.</p>
        </>
      )}
      {(error || tunnel?.error) && <p className="error-text" role="alert">{error || tunnel?.error}</p>}
      <div className="dialog-actions"><Button onClick={onClose}>Close</Button></div>
    </Dialog>
  )
}
