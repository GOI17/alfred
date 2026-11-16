import { useRef, useState } from 'react'
import type { AgentState } from '../../shared/contracts'
import { api, errorMessage } from './api'
import { useUI } from './ui-preferences'

type Operation = 'send' | 'stop' | 'queue'
type RequestState = { operation: Operation; phase: 'pending' | 'confirmed' | 'uncertain' }

/** Serialize mutations; a lost response is not evidence that a mutation failed. */
export function useChatRequest(conversationId: string, onError: (message: string) => void) {
  const lock = useRef(false)
  const [request, setRequest] = useState<RequestState>()
  async function perform(operation: Operation, path: string, body: object = {}) {
    if (lock.current) return false
    lock.current = true
    onError('')
    setRequest({ operation, phase: 'pending' })
    try {
      await api(`/conversations/${conversationId}/${path}`, body)
      setRequest({ operation, phase: 'confirmed' })
      lock.current = false
      return true
    } catch (error) {
      // Keep the lock: the server may have accepted the operation before disconnecting.
      setRequest({ operation, phase: 'uncertain' })
      onError(errorMessage(error))
      return false
    }
  }
  return { request, perform, blocked: request?.phase === 'pending' || request?.phase === 'uncertain' }
}

export function ChatRuntimeState({ agent, request }: { agent?: AgentState; request?: RequestState }) {
  const { t } = useUI()
  let message = ''
  if (request?.phase === 'uncertain') {
    message = t('The operation could not be confirmed. It will not be retried. Review the conversation and actual changes before reloading or sending again. Your draft and partial results are preserved.', 'No se pudo confirmar la operación. No se reintentará. Revisa la conversación y los cambios reales antes de recargar o volver a enviar. Se conservan el borrador y los resultados parciales.')
  } else if (request?.operation === 'stop' && request.phase === 'pending') {
    message = t('Stop requested. Waiting for the runtime; previous effects are not undone.', 'Detención solicitada. Esperando al runtime; no se revierten los efectos anteriores.')
  } else if (agent?.status === 'error') {
    message = t('Runtime error. Review partial results and changes before continuing. Nothing will be resent automatically.', 'Error del runtime. Revisa los resultados parciales y los cambios antes de continuar. No se reenviará nada automáticamente.')
  } else if (agent?.status === 'waiting') {
    message = agent.approval ? t('Waiting for approval.', 'Esperando aprobación.') : t('Runtime waiting.', 'Runtime en espera.')
  } else if (agent?.status === 'running') {
    message = t('Runtime is working…', 'El runtime está trabajando…')
  } else if (request?.operation === 'stop' && request.phase === 'confirmed') {
    message = t('Stop confirmed by the server; queue paused. Previous effects are not undone.', 'Detención confirmada por el servidor; cola pausada. No se revierten los efectos anteriores.')
  } else if (request?.phase === 'pending') {
    message = t('Sending request…', 'Enviando solicitud…')
  } else if (agent?.status === 'idle') {
    message = t('Runtime inactive. Check results in the conversation.', 'Runtime inactivo. Consulta los resultados en la conversación.')
  }
  return <p className="chat-runtime-state" role="status" aria-live="polite" aria-atomic="true">{message}</p>
}
