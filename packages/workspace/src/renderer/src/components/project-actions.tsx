import { useState } from 'react'
import DropdownMenu, { DropdownItem, DropdownItemGroup } from '@atlaskit/dropdown-menu'
import AtlassianButton from '@atlaskit/button/new'
import { Ellipsis, Trash2 } from 'lucide-react'
import { useUI } from '../ui-preferences'

export function ProjectActions({ removeProject }: { removeProject: () => void }) {
  const [open, setOpen] = useState(false)
  const { t } = useUI()
  return <div className="project-actions">
    <DropdownMenu isOpen={open} onOpenChange={({ isOpen }) => setOpen(isOpen)} placement="bottom-end"
      trigger={({ triggerRef, ...props }) => <AtlassianButton {...props} ref={triggerRef} appearance="subtle" data-alfred-button="icon" aria-label={t('Project actions', 'Acciones del proyecto')}><Ellipsis size={18} /></AtlassianButton>}>
      <DropdownItemGroup>
        <DropdownItem elemBefore={<Trash2 size={14} />} onClick={() => { setOpen(false); removeProject() }}>{t('Remove project', 'Eliminar proyecto')}</DropdownItem>
      </DropdownItemGroup>
    </DropdownMenu>
  </div>
}
