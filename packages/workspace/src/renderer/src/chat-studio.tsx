import { useEffect, useRef, useState, type Dispatch, type SetStateAction, type ComponentProps } from 'react'
import { ChatPanel } from './chat-panel'
import { ChatDeck } from './chat-deck'
import { StudioInspector } from './studio-inspector'

export function ChatStudio({ floatingIds, setFloatingIds, onActiveChatChange, ...props }: ComponentProps<typeof ChatPanel> & { onOpenGit?: () => void; onActiveChatChange?: (id: string) => void; floatingIds?: string[]; setFloatingIds?: Dispatch<SetStateAction<string[]>> }) {
  return <ChatDeck onActiveChatChange={onActiveChatChange} floatingIds={floatingIds} setFloatingIds={setFloatingIds} key={props.conversation.id} conversation={props.conversation} conversations={props.state.conversations} render={(conversation) => <StudioContent {...props} conversation={conversation} agent={props.state.agents[conversation.id]} />} />
}

const compactViewport = '(max-width: 1024px)'

function StudioContent({ onOpenGit, ...props }: ComponentProps<typeof ChatPanel> & { onOpenGit?: () => void }) {
  const [desktopOpen, setDesktopOpen] = useState(true)
  const [compactOpen, setCompactOpen] = useState(false)
  const [compact, setCompact] = useState(() => window.matchMedia(compactViewport).matches)
  useEffect(() => {
    const media = window.matchMedia(compactViewport)
    const sync = () => {
      setCompact(media.matches)
      setCompactOpen(false)
    }
    media.addEventListener('change', sync)
    sync()
    return () => media.removeEventListener('change', sync)
  }, [])
  const open = compact ? compactOpen : desktopOpen
  const setOpen = compact ? setCompactOpen : setDesktopOpen
  const chat = useRef<HTMLDivElement>(null)
  const { conversation, agent } = props
  const project = props.state.projects.find(item => item.id === conversation.projectId)
  return <div className="chat-studio" data-inspector-open={open}>
    <div className="studio-chat" ref={chat}>
      <ChatPanel {...props} />
    </div>
    <StudioInspector onOpenGit={onOpenGit} conversation={conversation} agent={agent} project={project} open={open} onToggle={() => setOpen(value => !value)} onAttach={() => chat.current?.querySelector<HTMLInputElement>('input[type="file"]')?.click()} />
  </div>
}
