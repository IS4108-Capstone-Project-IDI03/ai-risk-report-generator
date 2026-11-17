// The Settings screen (S-01): a menu of sections, each in its own file under screens/.
// Shown by features/assessments/AssessmentApp.tsx for every signed-in user. Calls api.ts.
import { useEffect, useState } from 'react'
import { Icon } from '../../design-system'
import { GatewayError } from '../assessments/api'
import { getSettings, type Settings as SettingsData } from './api'
import { ChatVoiceSection } from './screens/ChatVoiceSection'
import { ComingSoonSection } from './screens/ComingSoonSection'
import { DefaultsSection } from './screens/DefaultsSection'
import { DraftingSection } from './screens/DraftingSection'
import { ModelsSection } from './screens/ModelsSection'
import { PasswordSection } from './screens/PasswordSection'
import { QaSection } from './screens/QaSection'
import './settings.css'

type Save = (settings: SettingsData) => void
type Section = {
  id: string
  label: string
  render: (settings: SettingsData | null, onSaved: Save) => React.ReactNode
}

// Sections that need the loaded settings wait for them; the rest render at once.
const needs =
  (show: (s: SettingsData, onSaved: Save) => React.ReactNode): Section['render'] =>
  (s, onSaved) =>
    s ? show(s, onSaved) : <p className="st-note">Loading…</p>

const SECTIONS: Section[] = [
  { id: 'password', label: 'Password', render: () => <PasswordSection /> },
  {
    id: 'models',
    label: 'Models',
    render: needs((s, f) => <ModelsSection settings={s} onSaved={f} />),
  },
  {
    id: 'drafting',
    label: 'Drafting',
    render: needs((s, f) => <DraftingSection settings={s} onSaved={f} />),
  },
  { id: 'qa', label: 'QA check', render: needs((s, f) => <QaSection settings={s} onSaved={f} />) },
  { id: 'chat', label: 'Chat and voice', render: () => <ChatVoiceSection /> },
  {
    id: 'defaults',
    label: 'Defaults',
    render: needs((s, f) => <DefaultsSection settings={s} onSaved={f} />),
  },
  ...['Checklist', 'Source priority', 'Note-taking', 'QA criteria'].map((name) => ({
    id: name,
    label: name,
    render: () => <ComingSoonSection name={name} />,
  })),
]

export function Settings() {
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [problem, setProblem] = useState('')
  const [open, setOpen] = useState(SECTIONS[0].id)

  useEffect(() => {
    getSettings().then(setSettings, (error: unknown) =>
      setProblem(error instanceof GatewayError ? error.message : 'Could not load settings.'),
    )
  }, [])

  const section = SECTIONS.find((s) => s.id === open) ?? SECTIONS[0]
  return (
    <div className="st">
      <nav className="st-menu" aria-label="Settings sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="st-menu-item"
            aria-current={s.id === open || undefined}
            onClick={() => setOpen(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      <section className="st-panel" aria-label={section.label}>
        <h2 className="st-title">{section.label}</h2>
        {problem ? (
          <p className="st-err" role="alert">
            <Icon name="octagon-alert" size={14} color="var(--red-600)" /> {problem}
          </p>
        ) : (
          section.render(settings, setSettings)
        )}
      </section>
    </div>
  )
}
