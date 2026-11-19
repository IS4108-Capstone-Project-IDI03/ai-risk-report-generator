// The Settings screen (S-01): a menu of sections, each in its own file under screens/.
// Shown by features/assessments/AssessmentApp.tsx for every signed-in user. Calls api.ts.
import { useEffect, useState } from 'react'
import { Icon } from '../../design-system'
import { GatewayError } from '../assessments/api'
import { getSettings, type Settings as SettingsData } from './api'
import { ChatVoiceSection } from './screens/ChatVoiceSection'
import { ComingSoonSection } from './screens/ComingSoonSection'
import { ModelsSection } from './screens/ModelsSection'
import { NoteTakingSection } from './screens/NoteTakingSection'
import { PasswordSection } from './screens/PasswordSection'
import { SourcePrioritySection } from './screens/SourcePrioritySection'
import { QaSection } from './screens/QaSection'
import './settings.css'

type Save = (settings: SettingsData) => void
type Section = {
  id: string
  label: string
  // Set for sections someone else is still building; shown as a "Soon" tag in the menu.
  owner?: string
  render: (settings: SettingsData | null, onSaved: Save) => React.ReactNode
}

// Sections that need the loaded settings wait for them; the rest render at once.
const needs =
  (show: (s: SettingsData, onSaved: Save) => React.ReactNode): Section['render'] =>
  (s, onSaved) =>
    s ? show(s, onSaved) : <p className="st-note">Loading…</p>

const WORKING: Section[] = [
  { id: 'password', label: 'Password', render: () => <PasswordSection /> },
  {
    id: 'models',
    label: 'Models',
    render: needs((s, f) => <ModelsSection settings={s} onSaved={f} />),
  },
  {
    id: 'source-priority',
    label: 'Source priority',
    render: needs((s, f) => <SourcePrioritySection settings={s} onSaved={f} />),
  },
  {
    id: 'qa',
    label: 'QA eval',
    render: needs((s, f) => <QaSection settings={s} onSaved={f} />),
  },
  {
    id: 'chat',
    label: 'Chat and voice',
    render: needs((s, f) => <ChatVoiceSection settings={s} onSaved={f} />),
  },
  {
    id: 'note-taking',
    label: 'Note-taking',
    render: needs((s, f) => <NoteTakingSection settings={s} onSaved={f} />),
  },
]
// Built by teammates later; each shows who. Order here is the order in the menu.
const SOON: Section[] = [['Checklist', 'Xuren']].map(([name, owner]) => ({
  id: name,
  label: name,
  owner,
  render: () => <ComingSoonSection name={name} owner={owner} />,
}))
const SECTIONS = [...WORKING, ...SOON]

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
        {[WORKING, SOON].map((group, i) => (
          <div key={i} className="st-menu-group">
            {i === 1 && <div className="st-menu-heading">Coming soon</div>}
            {group.map((s) => (
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
          </div>
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
