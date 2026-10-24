import { useRef, useState, type Dispatch, type SetStateAction, type ComponentProps } from 'react'
import { ChatPanel } from './chat-panel'
import { ChatDeck } from './chat-deck'
import { StudioInspector } from './studio-inspector'

export function ChatStudio({ floatingIds, setFloatingIds, onActiveChatChange, ...props }: ComponentProps<typeof ChatPanel> & { onOpenGit?: () => void; onActiveChatChange?: (id: string) => void; floatingIds?: string[]; setFloatingIds?: Dispatch<SetStateAction<string[]>> }) {
  return <ChatDeck onActiveChatChange={onActiveChatChange} floatingIds={floatingIds} setFloatingIds={setFloatingIds} key={props.conversation.id} conversation={props.conversation} conversations={props.state.conversations} render={(conversation) => <StudioContent {...props} conversation={conversation} agent={props.state.agents[conversation.id]} />} />
}

function StudioContent({ onOpenGit, ...props }: ComponentProps<typeof ChatPanel> & { onOpenGit?: () => void }) {
  const [open, setOpen] = useState(true)
  const chat = useRef<HTMLDivElement>(null)
  const { conversation, agent } = props
  return <div className="chat-studio" data-inspector-open={open}>
    <div className="studio-chat" ref={chat}>
      <ChatPanel {...props} />
    </div>
    <StudioInspector conversation={conversation} agent={agent} project={props.state.projects.find((project) => project.id === conversation.projectId)} open={open} onToggle={() => setOpen(!open)} onOpenGit={onOpenGit} onAttach={() => chat.current?.querySelector<HTMLInputElement>('input[type="file"]')?.click()} />
  </div>
}
