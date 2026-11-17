// Settings > Models: one dropdown per AI task, with key lights. S-01 AC3-AC10.
// Called by Settings.tsx. Only an admin changes them; an engineer sees them read-only.
import type { Settings } from '../api'
import { ModelRow } from '../components/ModelRow'
import { SetByAdmin } from '../components/SetByAdmin'

type Props = { settings: Settings; onSaved: (settings: Settings) => void }

export function ModelsSection({ settings, onSaved }: Props) {
  return (
    <div className="st-stack">
      {!settings.canEditGlobal && <SetByAdmin />}
      <p className="st-note">A light shows whether the API key is set. It does not test the key.</p>
      {settings.models.map((row) => (
        <ModelRow key={row.task} row={row} canEdit={settings.canEditGlobal} onSaved={onSaved} />
      ))}
    </div>
  )
}
