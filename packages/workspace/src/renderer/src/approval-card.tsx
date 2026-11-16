import { useId, useRef, useState } from 'react'
import { FileCheck2, Check, X } from 'lucide-react'
import type { AgentState } from '../../shared/contracts'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'
import { useUI } from './ui-preferences'

export function ApprovalCard({ approval, conversationId, onError }: {
  approval: NonNullable<AgentState['approval']>; conversationId: string; onError: (message: string) => void
}) {
  const { t } = useUI()
  const operation = /^(Connect MCP:|MCP:|Terminal:)/.test(approval.path)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const titleId = useId()
  const lock = useRef(false)
  // Never infer permission from preview content. Decisions reference this exact approval ID.
  let files: { path: string; content: string }[] | undefined
  if (/^Batch of \d+ file\(s\)$/.test(approval.path)) {
    try {
      const parsed: unknown = JSON.parse(approval.content)
      if (parsed && typeof parsed === 'object' && 'files' in parsed && Array.isArray(parsed.files) && parsed.files.length > 0 &&
        parsed.files.every((file: unknown): file is { path: string; content: string } => !!file && typeof file === 'object' && 'path' in file && typeof file.path === 'string' && 'content' in file && typeof file.content === 'string')) files = parsed.files
    } catch { /* Fall back to the exact original preview. */ }
  }
  async function decide(accepted: boolean) {
    if (lock.current) return
    lock.current = true; setSaving(true)
    setNotice(t('Sending decision…', 'Enviando decisión…'))
    try {
      await api(`/conversations/${conversationId}/approval`, { approvalId: approval.id, accepted })
      setNotice(t('Decision received. Execution results will appear in the conversation.', 'Decisión recibida. Los resultados de ejecución aparecerán en la conversación.'))
    } catch (error) {
      onError(errorMessage(error))
      setNotice(t('Could not confirm receipt. Check the conversation before taking further action; the decision will not be resent.', 'No se pudo confirmar la recepción. Revisa la conversación antes de continuar; la decisión no se reenviará.'))
    } finally { setSaving(false) }
  }
  return <section className="approval-card" aria-labelledby={titleId}>
    <div><FileCheck2 size={18} /><strong id={titleId}>{operation ? t('Authorize operation', 'Autorizar operación') : t('Review changes', 'Revisar cambios')}</strong></div>
    {files ? <>
      <p>{t(`The runtime proposes saving ${files.length} file(s). This approval covers only the contents shown.`, `El runtime propone guardar ${files.length} archivo(s). Esta aprobación cubre solo el contenido mostrado.`)}</p>
      {files.map((file, index) => <details key={index}><summary><code>{file.path}</code> · {t('View proposed content', 'Ver contenido propuesto')}</summary><pre tabIndex={0} role="region" aria-label={`${t('Proposed content', 'Contenido propuesto')}: ${file.path}`}>{file.content}</pre></details>)}
      <p>{t('Saving is not atomic: if a file fails, successfully saved files will be reported.', 'El guardado no es atómico: si un archivo falla, se informarán los archivos guardados correctamente.')}</p>
    </> : <>
      <p>{operation ? t('The runtime requests authorization for', 'El runtime solicita autorización para') : t('The runtime proposes saving', 'El runtime propone guardar')} <code>{approval.path}</code></p>
      <details><summary>{t('View proposed content', 'Ver contenido propuesto')}</summary><pre tabIndex={0} role="region" aria-label={t('Proposed content', 'Contenido propuesto')}>{approval.content}</pre></details>
    </>}
    {approval.path.startsWith('Connect MCP:') && <p>{t('Authorize the connection for this conversation during the server session. Changing the configuration revokes this authorization. Tool calls retain their own permissions.', 'Autoriza la conexión para esta conversación durante la sesión del servidor. Cambiar la configuración revoca esta autorización. Las llamadas a herramientas conservan sus propios permisos.')}</p>}
    <p role="status" aria-atomic="true">{notice}</p>
    <div className="approval-actions" aria-busy={saving}>
      <Button variant="secondary" size="small" disabled={!!notice} onClick={() => void decide(false)}><X size={14} />{files ? t('Reject all', 'Rechazar todo') : t('Reject', 'Rechazar')}</Button>
      <Button size="small" disabled={!!notice} onClick={() => void decide(true)}><Check size={14} />{operation ? t('Authorize', 'Autorizar') : files ? t('Approve and save all', 'Aprobar y guardar todo') : t('Save file', 'Guardar archivo')}</Button>
    </div>
  </section>
}
