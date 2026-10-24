import { useEffect, useState } from 'react'
import type { PublicState } from '../../shared/contracts'
import { api, errorMessage } from './api'
import { Button } from './components/ui/button'
import { Select } from './components/ui/input'
import { Dialog } from './components/ui/dialog'

export function ChatgptSettings({ state }: { state: PublicState }) {
  const [local, setLocal] = useState(false),
    [error, setError] = useState(''),
    [models, setModels] = useState<{ slug: string; display_name: string }[]>([])
  const accounts = state.chatgpt.accounts
  const active = accounts.find((account) => account.id === state.chatgpt.active)
  useEffect(() => {
    void api<{ local: boolean }>('/chatgpt/availability')
      .then((result) => setLocal(result.local))
      .catch((error) => setError(errorMessage(error)))
  }, [])
  useEffect(() => {
    let current = true
    setModels([])
    if (active?.connected)
      void api<{ slug: string; display_name: string }[]>('/chatgpt/models')
        .then((result) => {
          if (current) setModels(result)
        })
        .catch((error) => {
          if (current) setError(errorMessage(error))
        })
    return () => {
      current = false
    }
  }, [active?.id, active?.connected])
  async function authorize(accountId?: string) {
    const popup = window.open('about:blank', '_blank')
    if (!popup) {
      setError('Allow a new tab to authorize ChatGPT.')
      return
    }
    popup.opener = null
    setError('')
    try {
      const result = await api<{ url: string }>('/chatgpt/authorize', { accountId })
      popup.location.href = result.url
    } catch (error) {
      popup.close()
      setError(errorMessage(error))
    }
  }
  const welcome = () => {
    if (active)
      void api('/chatgpt/welcome', { accountId: active.id }).catch((error) =>
        setError(errorMessage(error)),
      )
  }
  return (
    <section className="chatgpt-settings">
      <h3>Use your ChatGPT plan</h3>
      <p className="field-note">
        Authorize Alfred to make eligible requests using your ChatGPT plan.
      </p>
      {accounts.length > 0 && (
        <label>
          ChatGPT account
          <Select
            aria-label="ChatGPT account"
            value={active?.id || ''}
            onChange={(event) => {
              const account = accounts.find((item) => item.id === event.target.value)
              if (!account) return
              if (account.connected)
                void api('/chatgpt/select', { accountId: account.id }).catch((error) =>
                  setError(errorMessage(error)),
                )
              else void authorize(account.id)
            }}
          >
            <option value="" disabled>
              Select an account
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.label}
                {account.connected ? '' : ' · reconnect'}
              </option>
            ))}
          </Select>
        </label>
      )}
      {active?.connected && (
        <label>
          Model from your plan
          <Select
            value={active.model}
            onChange={(event) => {
              void api('/chatgpt/select', {
                accountId: active.id,
                model: event.target.value,
              }).catch((error) => setError(errorMessage(error)))
            }}
          >
            <option value="" disabled>
              {models.length ? 'Select a model' : 'Loading models…'}
            </option>
            {models.map((model) => (
              <option key={model.slug} value={model.slug}>
                {model.display_name}
              </option>
            ))}
          </Select>
        </label>
      )}
      <div className="account-actions">
        <Button variant="secondary" onClick={() => void authorize()} disabled={!local}>
          Continue with ChatGPT
        </Button>
        {active?.connected && (
          <Button
            variant="ghost"
            size="small"
            onClick={() => {
              void api<{ revoked: boolean }>('/chatgpt/disconnect', { accountId: active.id })
                .then((result) => {
                  if (!result.revoked)
                    setError(
                      'Signed out locally. Remote revocation was not confirmed; you can disconnect it in ChatGPT settings.',
                    )
                })
                .catch((error) => setError(errorMessage(error)))
            }}
          >
            Sign out
          </Button>
        )}
      </div>
      {!local && (
        <p className="field-note">
          Connect your account from the browser on the computer running Alfred. You can then
          use it here.
        </p>
      )}
      <a
        href="https://chatgpt.com/settings/usage"
        target="_blank"
        rel="noreferrer"
        className="text-link"
      >
        Manage usage in ChatGPT ↗
      </a>
      {(error || state.chatgpt.error) && (
        <p role="alert" className="error-text">
          {error || state.chatgpt.error}
        </p>
      )}
      {active?.connected && !active.welcomed && (
        <Dialog
          open
          title="You are using your ChatGPT plan"
          description="Eligible Alfred requests will use your ChatGPT plan. You can review usage and manage limits in ChatGPT settings."
          onClose={welcome}
        >
          <a
            className="text-link"
            href="https://chatgpt.com/settings/usage"
            target="_blank"
            rel="noreferrer"
          >
            Manage usage ↗
          </a>
          <div className="dialog-actions">
            <Button onClick={welcome}>Got it</Button>
          </div>
        </Dialog>
      )}
    </section>
  )
}
