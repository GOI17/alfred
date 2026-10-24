import { useState } from 'react'
import { Bell } from 'lucide-react'
import type { Conversation, PublicState } from '../../shared/contracts'
import { Button } from './components/ui/button'
import { Dialog } from './components/ui/dialog'
import { useUI } from './ui-preferences'

export function ActivityCenter({ state, connected, select }: {
  state: PublicState; connected: boolean; select: (conversation: Conversation) => void
}) {
  const { t } = useUI()
  const [open, setOpen] = useState(false)
  const active = state.conversations.filter((item) => ['running', 'waiting'].includes(state.agents[item.id]?.status))
  return <>
    <Button variant="ghost" size="small" onClick={() => setOpen(true)} aria-label={t('Activity', 'Actividad')} title={t('Activity', 'Actividad')}><Bell size={17} />{active.length > 0 && <span>{active.length}</span>}</Button>
    {open && <Dialog open onClose={() => setOpen(false)} title={t('Activity', 'Actividad')} description={t('Follow running chats and pending approvals.', 'Sigue los chats en ejecución y las aprobaciones pendientes.')}>
      <h3>{t('Running chats', 'Chats en ejecución')}</h3>
      {!connected && <p role="status">{t('Disconnected: these statuses may be out of date.', 'Sin conexión: estos estados pueden estar desactualizados.')}</p>}
      {!active.length && <p>{t('No running chats.', 'No hay chats en ejecución.')}</p>}
      <div style={{ display: 'grid', gap: 8, maxHeight: '35vh', overflowY: 'auto' }}>
        {active.map((item) => <Button key={item.id} variant="secondary" onClick={() => { select(item); setOpen(false) }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
          <span>{state.agents[item.id]?.status === 'waiting' ? t('Awaiting approval', 'Espera aprobación') : t('Running', 'En ejecución')}</span>
        </Button>)}
      </div>
    </Dialog>}
  </>
}
