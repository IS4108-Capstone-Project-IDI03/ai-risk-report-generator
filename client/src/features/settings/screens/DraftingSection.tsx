// Settings > Drafting: the share of sections that cite a standard (GN-13). S-01 AC12.
// Called by Settings.tsx.
import type { Settings } from '../api'
import { PersonalSettingField } from '../components/PersonalSetting'

type Props = { settings: Settings; onSaved: (settings: Settings) => void }

export function DraftingSection({ settings, onSaved }: Props) {
  return (
    <PersonalSettingField
      name="standardsTargetPct"
      label="Sections citing a standard"
      suffix="%"
      numeric
      setting={settings.personal.standardsTargetPct}
      canEditGlobal={settings.canEditGlobal}
      onSaved={onSaved}
    />
  )
}
