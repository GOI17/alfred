import { useState } from 'react'
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
    <p role="status">{result}</p>
    <Button disabled>No disponible</Button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Configuración de controles" description="Revisa los valores antes de guardar.">
      <form onSubmit={event => { event.preventDefault(); setOpen(false) }}>
        <label htmlFor="name">Nombre</label>
        <Input id="name" aria-invalid="true" aria-describedby="name-help name-error" />
        <p id="name-help" className="field-note">Usa un nombre descriptivo.</p>
        <p id="name-error" className="error-text">El nombre es obligatorio.</p>
        <label>Tipo<Select defaultValue="local"><option value="local">Local</option></Select></label>
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
