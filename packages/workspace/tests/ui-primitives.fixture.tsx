import '../src/renderer/src/assets/git-panel.css'
import { ChatColumnPicker } from '../src/renderer/src/chat-deck'
import '../src/renderer/src/assets/workspace-chrome.css'
import { ProjectActions } from '../src/renderer/src/components/project-actions'
import { useState } from 'react'
import { Settings2, FolderPlus, ArrowUpRight } from 'lucide-react'
import { createRoot } from 'react-dom/client'
import '../src/renderer/src/assets/main.css'
import { UIPreferences } from '../src/renderer/src/ui-preferences'
import { Button } from '../src/renderer/src/components/ui/button'
import { Input, Select, Textarea } from '../src/renderer/src/components/ui/input'
import { Dialog } from '../src/renderer/src/components/ui/dialog'
import { useConfirmation } from '../src/renderer/src/components/ui/confirmation'

function Fixture() {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState('Sin cambios')
  const { confirm, dialog } = useConfirmation('fixture')
  return <main style={{ padding: 16, background: 'var(--surface)', minHeight: '100dvh' }}>
    <Button onClick={() => setOpen(true)}>Abrir diálogo</Button>
    <Button onClick={async () => setResult(await confirm('Esta acción requiere confirmación.') ? 'Confirmado' : 'Cancelado')}>Acción sensible</Button>
    <p role="status">{result}</p><ProjectActions removeProject={() => setResult('Solicitud de eliminación')} />
    <Button disabled>No disponible</Button>
    <div className="workspace-header-unified">
      <div className="workspace-chat-actions" data-testid="column-picker-enabled"><ChatColumnPicker options={[{ id: 'chat-2', title: 'Segundo chat' }]} onSelect={id => setResult(id)} /></div>
      <div className="workspace-chat-actions" data-testid="column-picker-disabled"><ChatColumnPicker options={[]} onSelect={id => setResult(id)} /></div>
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      <Button size="icon" variant="ghost" aria-label="Ajustes de prueba"><Settings2 size={16} /></Button>
      <Button size="icon" aria-label="Ajustes principales"><Settings2 size={20} /></Button>
      <Button variant="secondary"><Settings2 size={16} /> Ajustar</Button>
    </div>
    <Button><FolderPlus size={17} />Add space<ArrowUpRight size={16} /></Button>
    <div className="git-workbench">
      <div className="git-sync-bar git-pull-strategy">
        <label>Pull strategy<Select aria-label="Pull strategy" defaultValue="ff-only"><option value="ff-only">Fast-forward only</option></Select></label>
        <Button variant="ghost" size="small">Fetch + prune…</Button>
      </div>
    </div>
    <Dialog open={open} onClose={() => setOpen(false)} title="Configuración de controles" description="Revisa los valores antes de guardar.">
      <form onSubmit={event => { event.preventDefault(); setOpen(false) }}>
        <label htmlFor="name">Nombre</label>
        <Input id="name" aria-invalid="true" aria-describedby="name-help name-error" />
        <p id="name-help" className="field-note">Usa un nombre descriptivo.</p>
        <p id="name-error" className="error-text">El nombre es obligatorio.</p>
        <label>Tipo<Select defaultValue="local"><option value="local">Local</option><option value="remote">Remoto</option></Select></label>
        <label>Notas<Textarea rows={3} /></label>
        <div className="dialog-actions">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar sin guardar los cambios</Button>
          <Button type="submit">Guardar la configuración de este espacio</Button>
        </div>
      </form>
    </Dialog>
    {dialog}
  </main>
}
const root = document.getElementById('root')
if (!root) throw new Error('Missing fixture root')
createRoot(root).render(<UIPreferences><Fixture /></UIPreferences>)
