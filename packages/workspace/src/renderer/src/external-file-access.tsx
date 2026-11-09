import { useState } from 'react'
import { api, errorMessage } from './api'
import { useUI } from './ui-preferences'

export type FileSuggestions = {
  files: string[]; truncated?: boolean
  authorization?: { folder: string; chooseFolder: boolean }
  authorizedFolder?: string
}
export function ExternalFileAccess({ conversationId, result, refresh, cancel, pick }: {
  conversationId: string; result: FileSuggestions; refresh: () => void; cancel: () => void; pick: (query: string) => void
}) {
  const { t } = useUI()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const authorization = result.authorization
  async function act(action: () => Promise<void>) {
    setBusy(true); setError('')
    try { await action() } catch (error) { setError(errorMessage(error)) }
    finally { setBusy(false) }
  }
  const base = `/conversations/${conversationId}/files`
  return <section aria-label={t('External folder access', 'Acceso a carpeta externa')} aria-busy={busy}>
    {authorization ? <>
      <strong>{t('Folder outside the project', 'Carpeta fuera del proyecto')}</strong>
      <p style={{ overflowWrap: 'anywhere' }}>{authorization.folder}</p>
      <p>{authorization.chooseFolder
        ? t('Choose a specific folder before authorizing access.', 'Elige una carpeta concreta antes de autorizar el acceso.')
        : t('Allow searching and reading this folder and its subfolders in this conversation. No writing or execution. Access expires when the server restarts.', 'Permitir buscar y leer esta carpeta y sus subcarpetas en esta conversación. Sin escritura ni ejecución. El permiso caduca al reiniciar el servidor.')}</p>
      <button type="button" disabled={busy} onClick={cancel}>{t('Cancel', 'Cancelar')}</button>
      {authorization.chooseFolder
        ? <button type="button" disabled={busy} onClick={() => void act(async () => {
          const selected = await api<{ query: string | null }>(`${base}/pick`, {})
          if (selected.query) pick(selected.query)
        })}>{t('Choose folder', 'Elegir carpeta')}</button>
        : <button type="button" disabled={busy} onClick={() => void act(async () => {
          await api(`${base}/authorize`, { folder: authorization.folder, confirmed: true })
          refresh()
        })}>{t('Allow reading', 'Permitir lectura')}</button>}
    </> : result.authorizedFolder && <>
      <small style={{ overflowWrap: 'anywhere' }}>{t('Read access: ', 'Acceso de lectura: ')}{result.authorizedFolder}</small>
      <button type="button" disabled={busy} onClick={() => void act(async () => {
        await api(`${base}/authorize`, { folder: result.authorizedFolder }, 'DELETE')
        refresh()
      })}>{t('Revoke', 'Revocar')}</button>
    </>}
    {busy && <p role="status">{t('Please wait…', 'Espera…')}</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
