import { useGitDialog } from './git-dialog'
import { useState } from 'react'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'
import { useUI } from './ui-preferences'

type Row = { hash: string; subject: string; action: string }
export function GitRebase({ endpoint, base, locked, act }: {
  endpoint: string; base: string; locked: boolean
  act: (body: Record<string, string>) => Promise<void>
}) {
  const { t } = useUI()
  const { confirm, dialog } = useGitDialog()
  const [plan, setPlan] = useState<{ head: string; base: string; rows: Row[] }>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  async function prepare() {
    setLoading(true); setError(''); setPlan(undefined)
    try {
      const result = await api<{ output: string }>(`${endpoint}/git/action`, { action: 'rebase-plan', base })
      const data = JSON.parse(result.output) as { head: string; base: string; commits: { hash: string; subject: string }[] }
      setPlan({ ...data, rows: data.commits.map(commit => ({ ...commit, action: 'pick' })) })
    } catch (cause) { setError(errorMessage(cause)) }
    finally { setLoading(false) }
  }
  function move(index: number, delta: number) {
    setPlan(previous => {
      if (!previous) return previous
      const rows = [...previous.rows]
      ;[rows[index], rows[index + delta]] = [rows[index + delta], rows[index]]
      return { ...previous, rows }
    })
  }
  return <section className="git-branch-card">
    {dialog}
    <h3>{t('Interactive rebase', 'Rebase interactivo')}</h3>
    <p>{t('Use this commit as the base (excluded). Rewrites subsequent linear commits, including published commits. A recovery branch is created. Squash combines messages; edit pauses for amend, then Continue.', 'Usa este commit como base (excluido). Reescribe los commits lineales posteriores, incluidos los publicados. Se crea una rama de recuperación. Squash combina mensajes; edit pausa para modificar el commit y luego Continuar.')}</p>
    <Button size="small" disabled={locked || loading} onClick={() => void prepare()}>{t('Prepare plan', 'Preparar plan')}</Button>
    {error && <p role="alert">{error}</p>}
    {plan && <>
      {plan.rows.map((row, index) => <div className="git-sync-bar" key={row.hash}>
        <span>{row.hash.slice(0, 7)} · {row.subject}</span>
        <select className="input" aria-label={`${t('Action', 'Acción')} ${row.hash.slice(0, 7)}`} value={row.action} disabled={locked} onChange={event => {
          const action = event.target.value
          setPlan(previous => previous && ({ ...previous, rows: previous.rows.map(value => value.hash === row.hash ? { ...value, action } : value) }))
        }}>{['pick', 'edit', 'squash', 'fixup', 'drop'].map(action => <option key={action}>{action}</option>)}</select>
        <Button size="small" disabled={locked || index === 0} aria-label={t('Move up', 'Subir')} onClick={() => move(index, -1)}>↑</Button>
        <Button size="small" disabled={locked || index === plan.rows.length - 1} aria-label={t('Move down', 'Bajar')} onClick={() => move(index, 1)}>↓</Button>
      </div>)}
      <Button disabled={locked || loading} onClick={async () => {
        if (await confirm(t('Rewrite these commits? Published hashes will change. Coordinate with collaborators before pushing. Dropped commits remain on the recovery branch.', '¿Reescribir estos commits? Cambiarán los hashes publicados. Coordina con tus colaboradores antes de subirlos. Los commits descartados permanecen en la rama de recuperación.')))
          void act({ action: 'rebase-apply', head: plan.head, base: plan.base, plan: JSON.stringify(plan.rows.map(({ hash, action }) => ({ hash, action }))) })
      }}>{t('Apply reviewed plan…', 'Aplicar plan revisado…')}</Button>
    </>}
  </section>
}
