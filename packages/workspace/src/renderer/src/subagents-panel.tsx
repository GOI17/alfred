import { useEffect, useState } from 'react'
import type { HarnessProjection, Subagent } from '../../shared/subagents'
import { useUI } from './ui-preferences'
import './assets/subagents.css'

// A missed heartbeat only affects freshness, never the reported agent status.
export const HARNESS_STALE_MS = 60_000
export function SubagentsPanel({ projections = [] }: { projections?: HarnessProjection[] }) {
  const { t, language } = useUI()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!projections.length) return
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [projections.length])
  if (!projections.length) return null
  function agentView(agent: Subagent, agents: Subagent[], depth = 0) {
    return <div key={agent.id}>
      <details className="subagent-card" style={{ marginInlineStart: Math.min(depth, 6) * 12 }}>
        <summary><strong>{agent.name}</strong> <span className="subagent-status">{agent.status}</span></summary>
        <div className="subagent-detail">
          <small>ID: {agent.id}{agent.parentId && <> · {t('Parent', 'Padre')}: {agent.parentId}</>}</small>
          <p>{agent.task}</p>
          {!!agent.activity.length && <details><summary>{t('Activity', 'Actividad')} · {agent.activity.length}</summary>
            <ol>{agent.activity.map((entry) => <li key={entry.id}>
              <small>{entry.kind}{entry.tool && ` · ${entry.tool}`}{entry.timestamp && <> · <time dateTime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString(language)}</time></>}</small>
              <pre>{entry.text}</pre>
            </li>)}</ol>
          </details>}
          {agent.result !== undefined && <div><strong>{t('Result', 'Resultado')}</strong><pre>{agent.result}</pre></div>}
        </div>
      </details>
      {agents.filter((child) => child.parentId === agent.id).map((child) => agentView(child, agents, depth + 1))}
    </div>
  }
  return <section className="subagents-panel" aria-label={t('Subagents', 'Subagentes')}>
    <h3>{t('Subagents', 'Subagentes')}</h3>
    <p className="subagents-note">{t('Read-only view. Managed by the harness.', 'Vista de solo lectura. Gestionados por el harness.')}</p>
    {projections.map((projection) => <details key={projection.harnessId} open className="harness-projection">
      <summary><strong>{projection.harnessId}</strong> · {projection.agents.length} · r{projection.revision}</summary>
      <p className="subagents-note"><time dateTime={projection.receivedAt}>{t('Last update', 'Última actualización')}: {new Date(projection.receivedAt).toLocaleString(language)}</time>
        {now - Date.parse(projection.receivedAt) > HARNESS_STALE_MS && <span role="status"> · {t('No recent updates; harness connection unconfirmed. Showing last reported state.', 'Sin actualizaciones recientes; conexión del harness sin confirmar. Se muestra el último estado reportado.')}</span>}
      </p>
      {!projection.agents.length && <p>{t('No subagents reported.', 'No hay subagentes reportados.')}</p>}
      {projection.agents.filter((agent) => !agent.parentId).map((agent) => agentView(agent, projection.agents))}
    </details>)}
  </section>
}
