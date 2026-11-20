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

// What each person sets for themselves comes first, with no heading.
const MINE: Section[] = [
  { id: 'password', label: 'Password', render: () => <PasswordSection /> },
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
// What only a knowledge admin can change, for everyone. An engineer sees these read-only.
const ADMIN: Section[] = [
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
]
// Built by teammates later; each shows who. Order here is the order in the menu.
const SOON: Section[] = [
  ['QA eval', 'Chris'],
  ['Checklist', 'Xuren'],
].map(([name, owner]) => ({
  id: name,
  label: name,
  owner,
  render: () => <ComingSoonSection name={name} owner={owner} />,
}))
// The menu's groups, top to bottom, each with an optional heading.
const GROUPS: { heading?: string; items: Section[] }[] = [
  { items: MINE },
  { heading: 'Set by admin', items: ADMIN },
  { heading: 'Coming soon', items: SOON },
]
const SECTIONS = GROUPS.flatMap((g) => g.items)

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
        {GROUPS.map((group, i) => (
          <div key={i} className="st-menu-group">
            {group.heading && <div className="st-menu-heading">{group.heading}</div>}
            {group.items.map((s) => (
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
