import type { ProviderId } from '../../../shared/contracts'

const labels: Record<ProviderId, string> = {
  copilot: 'GitHub Copilot', opencode: 'OpenCode Zen',
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', chatgpt: 'ChatGPT',
}

/** Inline marks: no remote images or requests when rendering conversation history. */
export function ProviderLogo({ provider, size = 15 }: { provider?: ProviderId; size?: number }) {
  const label = provider ? labels[provider] : 'Provider no registrado'
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
    style={{ flexShrink: 0 }} role="img" aria-label={label}>
    <title>{label}</title>
    {provider === 'anthropic' ? <path d="M8.4 3 0 21h4.3l1.7-3.8h8.8l1.7 3.8h4.3L12.4 3h-4Zm2 4.3 2.9 6.5H7.5l2.9-6.5ZM16 3h4l4 9v9L16 3Z" />
      : provider === 'google' ? <>
        <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z" />
        <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z" />
        <path fill="#FBBC05" d="M6.4 13.92a6 6 0 0 1 0-3.84V7.49H3.06a10 10 0 0 0 0 9.02l3.34-2.59Z" />
        <path fill="#EA4335" d="M12 5.96c1.47 0 2.79.5 3.83 1.5L18.7 4.6A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.49l3.34 2.59C7.19 7.72 9.4 5.96 12 5.96Z" />
      </>
      : provider === 'openai' || provider === 'chatgpt' ? <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
        {[0, 60, 120, 180, 240, 300].map((angle) => <path key={angle} transform={`rotate(${angle} 12 12)`}
          d="M12 3a5 5 0 0 1 8.66 5v6L12 19l-3-1.73V9l6-3.46" />)}
      </g>
      : <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />}
  </svg>
}
