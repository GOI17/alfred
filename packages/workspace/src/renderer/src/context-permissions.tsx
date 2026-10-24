import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ShieldCheck, X } from 'lucide-react'
import type { Conversation, PermissionMode, ProviderId, PublicState } from '../../shared/contracts'
import { latestContextUsage, contextRemaining, conversationConsumption } from '../../shared/context-usage'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'
import { useUI } from './ui-preferences'
import './assets/context-permissions.css'

function Control({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
  const { t } = useUI()
  const [open, setOpen] = useState(false)
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 700px)').matches)
  const trigger = useRef<HTMLButtonElement>(null)
  const [position, setPosition] = useState({ left: 12, bottom: 12, maxHeight: 400 })
  useEffect(() => {
    const query = matchMedia('(max-width: 700px)')
    const update = () => setMobile(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useLayoutEffect(() => {
    if (!open || mobile) return
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect()
      if (!rect) return
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - Math.min(360, window.innerWidth - 24) - 12)), bottom: Math.max(12, window.innerHeight - rect.top + 8), maxHeight: Math.max(0, rect.top - 20) })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [open, mobile])
  return <Dialog.Root modal={mobile} open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild><button ref={trigger} type="button" className="context-control" title={label}>{icon}<span>{label}</span></button></Dialog.Trigger>
    <Dialog.Portal>
      {mobile && <Dialog.Overlay className="dialog-overlay" />}
      <Dialog.Content className={`dialog-content context-dialog${mobile ? '' : ' context-dropdown'}`} style={mobile ? undefined : position}>
        <div className="dialog-heading"><Dialog.Title>{label}</Dialog.Title><Dialog.Close asChild><Button type="button" variant="ghost" size="icon" aria-label={t('Close', 'Cerrar')}><X size={18} /></Button></Dialog.Close></div>
        <Dialog.Description>{t('Information and controls for this conversation.', 'Información y controles de esta conversación.')}</Dialog.Description>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
export function ContextPermissions({ conversation, state, provider, busy }: {
  conversation: Conversation; state: PublicState; provider: ProviderId; busy: boolean
}) {
  const { t, language } = useUI()
  const [saving, setSaving] = useState(false)
  const [compacting, setCompacting] = useState(false)
  const [compactError, setCompactError] = useState('')
  const compactLock = useRef(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<PermissionMode | null>(null)
  const lock = useRef(false)
  const mode = conversation.permissionMode || 'approval'
  const model = state.providers.find((item) => item.id === provider)?.model
  const measured = latestContextUsage(conversation.messages, provider, model)
  const usage = measured && (!conversation.compaction || measured.measuredAt > conversation.compaction.createdAt) ? measured : undefined
  const consumption = conversationConsumption(conversation)
  const format = (value: number) => value.toLocaleString(language)
  const consumptionLabel = consumption.incomplete && consumption.total === 0 ? t('Unavailable', 'No disponible') : `${format(consumption.total)} tokens${consumption.incomplete ? t(' (partial)', ' (parcial)') : ''}`
  const used = usage?.inputTokens
  const remaining = usage ? contextRemaining(usage) : undefined
  const percentage = used !== undefined && usage?.limit && usage.limit > 0 ? Math.round(used / usage.limit * 100) : undefined
  const ringValue = percentage === undefined ? 0 : Math.max(0, Math.min(100, percentage))
  const contextLabel = used === undefined ? '—' : usage?.limit === undefined ? `${format(used)} tokens` : `${format(used)} / ${format(usage.limit)} tokens`
  const permissionLabel = (value: PermissionMode) => value === 'read-only' ? t('Read only', 'Solo lectura') : value === 'full-access' ? t('Full access', 'Acceso completo') : t('Ask for approval', 'Solicitar aprobación')
  async function compact(reduction: 30 | 50 | 70) {
    if (compactLock.current || busy) return
    if (!window.confirm(t(`Attempt to reduce context by ${reduction}%? Visible messages and recorded consumption will be kept. Summarization uses your selected model and consumes tokens. The reduction is approximate; some detail may be lost.`, `¿Intentar reducir el contexto un ${reduction}%? Se conservarán los mensajes visibles y el consumo registrado. El resumen usa el modelo seleccionado y consume tokens. La reducción es aproximada; se pueden perder detalles.`))) return
    compactLock.current = true
    setCompacting(true); setCompactError('')
    try { await api(`/conversations/${conversation.id}/compact`, { provider, reduction }) }
    catch (error) { setCompactError(errorMessage(error)) }
    finally { compactLock.current = false; setCompacting(false) }
  }
  async function change(value: PermissionMode, stopFirst = false) {
    if (lock.current || value === mode) return
    if (busy && !stopFirst) { setPending(value); setError(''); return }
    if (value === 'full-access' && !window.confirm(t('Enable Full access for this conversation?\n\nThe agent can create and overwrite workspace files without approval, including when processing the queue. Enabled terminal and authorized MCP tools can run automatically, including ask permissions. Explicit blocks are respected. Terminal and MCP are not sandboxed to the workspace. Stopping does not undo completed actions.\n\nThis permission persists across reloads until you change it.', '¿Activar acceso completo para esta conversación?\n\nEl agente puede crear y reemplazar archivos sin aprobación, incluso al procesar la cola. Terminal habilitada y herramientas MCP autorizadas pueden ejecutarse automáticamente, incluidos permisos de consulta. Se respetan los bloqueos explícitos. Terminal y MCP no están aislados al workspace. Detener no deshace acciones completadas.\n\nEste permiso persiste al recargar hasta que lo cambies.'))) return
    lock.current = true; setSaving(true); setError('')
    try {
      if (stopFirst) await api(`/conversations/${conversation.id}/stop`, {})
      await api(`/conversations/${conversation.id}/permissions`, { mode: value, confirmed: value === 'full-access' }, 'PUT')
      setPending(null)
    } catch (error) { setError(errorMessage(error)) }
    finally { lock.current = false; setSaving(false) }
  }
  return <>
    <Control label={`${t('Context', 'Contexto')}: ${percentage === undefined ? '—' : `${percentage}%`}`} icon={<svg className="context-ring" viewBox="0 0 32 32" aria-hidden="true" data-level={percentage === undefined ? 'unknown' : percentage >= 90 ? 'danger' : percentage >= 70 ? 'warning' : 'normal'}><circle className="context-ring-track" cx="16" cy="16" r="12" fill="none" strokeWidth="3" /><circle className="context-ring-value" cx="16" cy="16" r="12" fill="none" strokeWidth="3" pathLength="100" strokeDasharray={`${ringValue} 100`} strokeLinecap={ringValue ? 'round' : 'butt'} /></svg>}>
      <p><strong>{t('Context', 'Contexto')}:</strong> {contextLabel}</p>
      {percentage === undefined && <p>{t('Percentage unavailable until both input usage and the model limit are known.', 'Porcentaje no disponible hasta conocer el uso de entrada y el límite del modelo.')}</p>}
      {remaining !== undefined && <p>{t('Remaining at last measurement', 'Disponible en la última medición')}: {format(remaining)} tokens.</p>}
      <p>{t('Context is the last measured input, not a live count. After compaction it is measured again on the next request.', 'El contexto es la última entrada medida, no un contador en vivo. Tras compactar se mide nuevamente en la siguiente solicitud.')}</p>
      <p><strong>{t('Total consumed', 'Consumo acumulado')}:</strong> {consumptionLabel}</p>
      <p>{t('Recorded input + output across calls, including continuations and compaction. Cached input is counted once per call. This is not remaining context or subscription quota.', 'Entrada + salida registradas entre llamadas, incluidas continuaciones y compactación. La entrada en caché se cuenta una vez por llamada. No es el contexto disponible ni la cuota de suscripción.')}</p>
      {consumption.incomplete && <p role="status">{t('Historical usage is incomplete; missing calls cannot be reconstructed.', 'El consumo histórico es incompleto; las llamadas faltantes no pueden reconstruirse.')}</p>}
      <fieldset disabled={busy || compacting || !!conversation.queue?.length || !model}>
        <legend>{t('Compact context — target reduction', 'Compactar contexto — reducción deseada')}</legend>
        {([30, 50, 70] as const).map((reduction) => <Button key={reduction} type="button" variant="secondary" onClick={() => void compact(reduction)}>{reduction}%</Button>)}
      </fieldset>
      <p>{t('Manual, approximate reduction. Recent messages remain intact. Higher reductions lose more detail; visible history and total consumption are preserved.', 'Reducción manual y aproximada. Los mensajes recientes permanecen intactos. Una mayor reducción pierde más detalle; el historial visible y el consumo total se conservan.')}</p>
      {compacting && <p role="status">{t('Compacting context…', 'Compactando contexto…')}</p>}
      {compactError && <p role="alert" className="error-text">{compactError}</p>}
    </Control>
    <Control label={permissionLabel(mode)} icon={<ShieldCheck size={15} />}>
      <fieldset className="permission-options" disabled={saving}>
        <legend>{t('Agent permissions', 'Permisos del agente')}</legend>
        <label><input type="radio" name={`permission-${conversation.id}`} checked={mode === 'read-only'} onChange={() => void change('read-only')} />{permissionLabel('read-only')}<small>{t('Explore and respond, without file writes, terminal, or MCP.', 'Explorar y responder, sin escribir archivos, terminal ni MCP.')}</small></label>
        <label><input type="radio" name={`permission-${conversation.id}`} checked={mode === 'approval'} onChange={() => void change('approval')} />{permissionLabel('approval')}<small>{t('Every write, command, or MCP execution requires explicit approval.', 'Cada escritura, comando o ejecución MCP requiere aprobación explícita.')}</small></label>
        <label><input type="radio" name={`permission-${conversation.id}`} checked={mode === 'full-access'} onChange={() => void change('full-access')} />{permissionLabel('full-access')}<small>{t('Automatic writes. Terminal and MCP must be enabled separately; authorized tools run without prompting, including ask permissions. Explicit blocks are respected.', 'Escrituras automáticas. Terminal y MCP se habilitan por separado; las herramientas autorizadas se ejecutan sin preguntar, incluidos permisos de consulta. Se respetan los bloqueos explícitos.')}</small></label>
      </fieldset>
      {mode === 'full-access' && <p role="status">{t('Full access active: authorized operations run automatically. Stopping does not undo completed changes.', 'Acceso completo activo: las operaciones autorizadas se ejecutan automáticamente. Detener no deshace cambios completados.')}</p>}
      <p>{t('Saved per conversation and applied to queued messages. Does not change manual terminal, browser, or Git controls.', 'Guardado por conversación y aplicado a mensajes en cola. No cambia los controles manuales de terminal, navegador o Git.')}</p>
      {busy && !pending && <p role="status">{t('Select another permission to stop the agent and change it.', 'Selecciona otro permiso para detener el agente y cambiarlo.')}</p>}
      {pending && pending !== mode && <div><p role="status">{t('Switch to', 'Cambiar a')} <strong>{permissionLabel(pending)}</strong>: {t('the run will stop, pending approval will be rejected, and the queue will pause. Completed writes will not be undone and work will not resume automatically.', 'la ejecución se detendrá, la aprobación pendiente se rechazará y la cola se pausará. Las escrituras completadas no se desharán ni se reanudará el trabajo automáticamente.')}</p><Button type="button" disabled={saving} onClick={() => void change(pending, true)}>{t('Stop and change permissions', 'Detener y cambiar permisos')}</Button><Button type="button" variant="secondary" disabled={saving} onClick={() => setPending(null)}>{t('Cancel', 'Cancelar')}</Button></div>}
      {saving && <p role="status">{t('Saving permissions…', 'Guardando permisos…')}</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      <p>{t('Configure terminal and MCP servers in Settings → Terminal and MCP.', 'Configura terminal y servidores MCP en Ajustes → Terminal y MCP.')}</p>
    </Control>
  </>
}
