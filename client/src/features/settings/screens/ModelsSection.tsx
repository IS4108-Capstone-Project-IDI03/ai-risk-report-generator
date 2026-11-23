// Settings > Models: one dropdown per AI task, with key lights. S-01 AC3-AC10.
// Called by Settings.tsx. Only an admin changes them; an engineer sees them read-only.
// The "light shows whether the key is set" line is the help tip beside the title (Settings.tsx).
// An engineer sees "Set by an admin" once, in the title bar's end slot.
import type { Settings } from '../api'
import { ModelRow } from '../components/ModelRow'
import { SetByAdmin } from '../components/SetByAdmin'

type Props = {
  settings: Settings
  onSaved: (settings: Settings) => void
  titleEnd: HTMLElement | null
}

export function ModelsSection({ settings, onSaved, titleEnd }: Props) {
  const rows = settings.models.filter((row) => row.task !== 'transcription')
  const used = rows.filter((row) => row.inUse !== false)
  const unused = rows.filter((row) => row.inUse === false)
  return (
    <>
      {!settings.canEditGlobal && <SetByAdmin into={titleEnd} />}
      {/* Voice transcription is set under Chat and voice, next to the other voice options */}
      {used.map((row) => (
        <ModelRow key={row.task} row={row} canEdit={settings.canEditGlobal} onSaved={onSaved} />
      ))}
      {unused.length > 0 && (
        <section className="st-unused" aria-labelledby="st-unused-title">
          <div className="st-unused-head">
            <h3 id="st-unused-title" className="st-group-title">
              Not used yet
            </h3>
            <p className="st-note">
              These tasks do not read a model setting yet, so they cannot be changed.
            </p>
          </div>
          {unused.map((row) => (
            <ModelRow key={row.task} row={row} canEdit={false} unused onSaved={onSaved} />
          ))}
        </section>
      )}
    </>
  )
}
