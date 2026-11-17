// Settings > Defaults: starting values for new assessments (country, facility type, my title). S-01 AC11.
// Called by Settings.tsx.
import type { PersonalKey, Settings } from '../api'
import { PersonalSettingField } from '../components/PersonalSetting'

type Props = { settings: Settings; onSaved: (settings: Settings) => void }

const FIELDS: { name: PersonalKey; label: string }[] = [
  { name: 'defaultCountry', label: 'Country' },
  { name: 'defaultFacilityType', label: 'Facility type' },
  { name: 'defaultTitle', label: 'My title' },
]

export function DefaultsSection({ settings, onSaved }: Props) {
  return (
    <div className="st-stack">
      {FIELDS.map((f) => (
        <PersonalSettingField
          key={f.name}
          {...f}
          setting={settings.personal[f.name]}
          canEditGlobal={settings.canEditGlobal}
          onSaved={onSaved}
        />
      ))}
    </div>
  )
}
