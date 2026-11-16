import { useEffect, useRef, useState } from 'react'
import { Dialog } from './components/ui/dialog'
import { Check, ChevronDown } from 'lucide-react'
import type { ProviderId, PublicState } from '../../shared/contracts'
import { apiProviderId } from '../../shared/contracts'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'
import { providerNames } from './provider-names'
import { useUI } from './ui-preferences'
import './assets/model-picker.css'

type Model = { id: string; name: string }
type ModelOption = Model & { connection: ProviderId }
const providerGroup = (id: ProviderId) => id === 'chatgpt' ? 'openai' : id
export function ModelPicker({ state, provider, onSelect, settings, disabled }: {
  state: PublicState; provider: ProviderId; onSelect: (provider: ProviderId) => void
  settings: () => void; disabled: boolean
}) {
  const { t } = useUI()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState(providerGroup(provider))
  const [models, setModels] = useState<ModelOption[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const connected = (id: ProviderId) => id === 'chatgpt'
    ? state.chatgpt.accounts.some((account) => account.id === state.chatgpt.active && account.connected)
    : state.providers.some((item) => item.id === id)
  const groupConnected = (id: ProviderId) => connected(id) || (id === 'openai' && connected('chatgpt'))
  const available = groupConnected(view)
  const connections: ProviderId[] = view === 'openai'
    ? (provider === 'chatgpt' ? ['chatgpt', 'openai'] : ['openai', 'chatgpt']) : [view]
  const connectionKey = connections.filter(connected).join(',')
  const activeModel = provider === 'chatgpt'
    ? state.chatgpt.accounts.find((account) => account.id === state.chatgpt.active)?.model
    : state.providers.find((item) => item.id === provider)?.model
  useEffect(() => {
    let current = true
    setModels([]); setError(''); setLoading(open && available)
    if (open && available) {
      const sources = connectionKey.split(',').filter((value): value is ProviderId => value === 'chatgpt' || apiProviderId.options.some(id => id === value))
      void Promise.allSettled(sources.map(async (connection) => {
        const items = await api<Model[]>(`/providers/${connection}/models`)
        return items.map((item) => ({ ...item, connection }))
      })).then((results) => {
        if (!current) return
        const unique = new Map<string, ModelOption>()
        const errors: string[] = []
        for (const result of results) {
          if (result.status === 'rejected') errors.push(errorMessage(result.reason))
          else for (const model of result.value) { if (!unique.has(model.id)) unique.set(model.id, model) }
        }
        setModels([...unique.values()]); setError(errors.join('; ')); setLoading(false)
      })
    }
    return () => { current = false }
  }, [open, view, available, connectionKey, retry, state.chatgpt.active])
  async function select(model: ModelOption) {
    if (lock.current) return
    lock.current = true; setSaving(true); setError('')
    try {
      await api(`/providers/${model.connection}/model`, { model: model.id }, 'PUT')
      onSelect(model.connection); setOpen(false)
    } catch (error) { setError(errorMessage(error)) }
    finally { lock.current = false; setSaving(false) }
  }
  function show() {
    setView(providerGroup(provider)); setModels([]); setError(''); setLoading(groupConnected(providerGroup(provider))); setOpen(true)
  }
  return <>
    <Button variant="secondary" data-control="model-picker-trigger" disabled={disabled} aria-haspopup="dialog" aria-expanded={open} onClick={show} aria-label={`${t('Select model', 'Seleccionar modelo')}: ${activeModel || providerNames[providerGroup(provider)]}`} title={activeModel}>
      <span>{activeModel || providerNames[providerGroup(provider)]}</span><ChevronDown size={14} />
    </Button>
    <Dialog open={open} onClose={() => { if (!lock.current) setOpen(false) }} title={t('Select model', 'Seleccionar modelo')}
      description={t('The selected model will be the default for its connection for future messages.', 'El modelo seleccionado será el predeterminado de su conexión para futuros mensajes.')}>
        <div className="model-picker-columns">
          <nav className="model-provider-list" aria-label={t('Supported providers', 'Proveedores compatibles')}>
            {apiProviderId.options.map((id) => <button type="button" key={id} aria-pressed={view === id} disabled={saving} onClick={() => { if (id !== view) { setModels([]); setError(''); setLoading(groupConnected(id)); setView(id) } }}>
              <span>{providerNames[id]}</span><small>{groupConnected(id) ? t('Connected', 'Conectado') : t('Not connected', 'Sin conectar')}</small>
            </button>)}
          </nav>
          <section className="model-results" aria-label={`${t('Models from', 'Modelos de')} ${providerNames[view]}`} aria-busy={loading || saving}>
            {!available ? <><p>{t(`Connect ${providerNames[view]} to view its models.`, `Conecta ${providerNames[view]} para ver sus modelos.`)}</p><Button size="small" onClick={() => { setOpen(false); settings() }}>{t('Configure provider', 'Configurar proveedor')}</Button></>
              : <>
                {loading && <div role="status" aria-label={t('Loading models', 'Cargando modelos')}>
                  <div className="model-skeleton-list" aria-hidden="true">
                    {Array.from({ length: 6 }, (_, index) => <div className="model-skeleton-row" key={index}><span className="model-skeleton-line" /><span className="model-skeleton-line model-skeleton-detail" /></div>)}
                  </div>
                </div>}
                {error && <div role="alert"><p className="error-text">{error}</p><Button size="small" variant="secondary" disabled={saving} onClick={() => { setError(''); setLoading(true); setRetry((value) => value + 1) }}>{t('Retry', 'Reintentar')}</Button></div>}
                {!loading && !error && !models.length && <p>{t('No models available.', 'No hay modelos disponibles.')}</p>}
                {models.map((model) => <button type="button" className="model-option" key={model.id} disabled={saving || loading} aria-pressed={provider === model.connection && activeModel === model.id} onClick={() => void select(model)}>
                  <span>{model.name}{model.name !== model.id && <small>{model.id}</small>}</span>
                  {provider === model.connection && activeModel === model.id && <Check size={16} />}
                </button>)}
                {saving && <p role="status">{t('Selecting model…', 'Seleccionando modelo…')}</p>}
              </>}
          </section>
        </div>
    </Dialog>
  </>
}
