// The Settings screen (S-01): a menu of sections, each in its own file under screens/.
// Shown by features/assessments/AssessmentApp.tsx for every signed-in user. Calls api.ts.
import { useEffect, useRef, useState } from 'react'
import { Icon, TopBar, useIsPhone } from '../../design-system'
import { GatewayError } from '../assessments/api'
import { Tip } from '../help/Tip'
import { useWalkthroughScreen } from '../walkthrough/useWalkthroughScreen'
import { getSettings, type Settings as SettingsData } from './api'
import { ChecklistSection } from './screens/ChecklistSection'
import { ChatVoiceSection } from './screens/ChatVoiceSection'
import { ComingSoonSection } from './screens/ComingSoonSection'
import { ModelsSection } from './screens/ModelsSection'
import { PasswordSection } from './screens/PasswordSection'
import { PrivacyWordsSection } from './screens/PrivacyWordsSection'
import { SourcePrioritySection } from './screens/SourcePrioritySection'
import { WalkthroughsSection } from './screens/WalkthroughsSection'
import './settings.css'

type Save = (settings: SettingsData) => void
type Section = {
  id: string
  label: string
  // The menu item's own icon (lucide name).
  icon: string
  // Set for sections someone else is still building; shown as a "Soon" tag in the menu.
  owner?: string
  // Shown to a knowledge admin only, not read-only to an engineer (PV-09: client data).
  adminOnly?: boolean
  // The menu item's walkthrough tag (F-12); written out in full so a search for it finds this line.
  walk?: string
  // A help tip beside the title (F-13).
  tip?: React.ReactNode
  // `titleEnd` is the right end of the title line: a section may draw its main button there (F-12).
  render: (
    settings: SettingsData | null,
    onSaved: Save,
    titleEnd: HTMLElement | null,
  ) => React.ReactNode
}

// Sections that need the loaded settings wait for them; the rest render at once.
const needs =
  (
    show: (s: SettingsData, onSaved: Save, titleEnd: HTMLElement | null) => React.ReactNode,
  ): Section['render'] =>
  (s, onSaved, titleEnd) =>
    s ? show(s, onSaved, titleEnd) : <p className="st-note">Loading…</p>

// What each person sets for themselves comes first, with no heading.
const MINE: Section[] = [
  {
    id: 'password',
    icon: 'key-round',
    label: 'Password',
    walk: 'settings.menu.password',
    render: () => <PasswordSection />,
  },
  {
    id: 'chat',
    icon: 'messages-square',
    label: 'Chat and Voice',
    walk: 'settings.menu.chat',
    render: needs((s, f) => <ChatVoiceSection settings={s} onSaved={f} />),
  },
  {
    id: 'walkthroughs',
    icon: 'route',
    label: 'Walkthroughs',
    walk: 'settings.menu.walkthroughs',
    render: (_s, _f, titleEnd) => <WalkthroughsSection titleEnd={titleEnd} />,
  },
]
// What only a knowledge admin can change, for everyone. An engineer sees these read-only.
const ADMIN: Section[] = [
  {
    id: 'models',
    icon: 'cpu',
    label: 'Models',
    walk: 'settings.menu.models',
    tip: <Tip id="settings.models" />,
    render: needs((s, f, end) => <ModelsSection settings={s} onSaved={f} titleEnd={end} />),
  },
  {
    id: 'source-priority',
    icon: 'list-ordered',
    label: 'Source Priority',
    walk: 'settings.menu.source-priority',
    render: needs((s, f, end) => <SourcePrioritySection settings={s} onSaved={f} titleEnd={end} />),
  },
  {
    id: 'checklist',
    icon: 'list-checks',
    label: 'Checklist',
    walk: 'settings.menu.checklist',
    render: needs((s, _f, end) => <ChecklistSection canEdit={s.canEditGlobal} titleEnd={end} />),
  },
  {
    id: 'privacy-words',
    icon: 'shield',
    label: 'Privacy Words',
    adminOnly: true,
    walk: 'settings.menu.privacy-words',
    render: () => <PrivacyWordsSection />,
  },
]
// Built by teammates later; each shows who. Order here is the order in the menu.
const SOON: Section[] = [['QA Eval', 'Chris', 'flask-conical']].map(([name, owner, icon]) => ({
  id: name,
  label: name,
  icon,
  owner,
  render: () => <ComingSoonSection owner={owner} />,
}))
// The menu's groups, top to bottom, each with an optional heading.
const GROUPS: { heading?: string; items: Section[] }[] = [
  { items: MINE },
  { heading: 'Set by admin', items: ADMIN },
  { heading: 'Coming soon', items: SOON },
]
const SECTIONS = GROUPS.flatMap((g) => g.items)

/** Returns the Settings screen: the kit top bar (the same as Assessments), the menu and the open section. */
export function Settings({ bell }: { bell?: React.ReactNode }) {
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [problem, setProblem] = useState('')
  const [open, setOpen] = useState(SECTIONS[0].id)
  // The right end of the title line, for the section that draws its main button there.
  const [titleEnd, setTitleEnd] = useState<HTMLElement | null>(null)
  const menu = useRef<HTMLElement>(null)
  const phone = useIsPhone()
  useWalkthroughScreen('settings', settings !== null)

  useEffect(() => {
    getSettings().then(setSettings, (error: unknown) =>
      setProblem(error instanceof GatewayError ? error.message : 'Could not load settings.'),
    )
  }, [])

  // On a phone the menu is a row that scrolls sideways: bring the open item into view, or a
  // section opened from elsewhere would sit off the edge with nothing showing which one it is.
  useEffect(() => {
    menu.current
      ?.querySelector('[aria-current]')
      ?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' })
  }, [open])

  const section = SECTIONS.find((s) => s.id === open) ?? SECTIONS[0]
  return (
    <div className="st-page">
      <TopBar
        eyebrow={phone ? undefined : 'ACCOUNT'}
        title="Settings"
        helper={phone ? undefined : 'Your password and preferences, and how the system is set.'}
        bell={bell}
      />
      <div className="st">
        <nav ref={menu} className="st-menu" aria-label="Settings sections">
          {GROUPS.map((group, i) => (
            <div key={i} className="st-menu-group">
              {group.heading && <div className="st-menu-heading">{group.heading}</div>}
              {group.items
                .filter((s) => !s.adminOnly || settings?.canEditGlobal)
                .map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className="st-menu-item"
                    data-walk={s.walk}
                    aria-current={s.id === open || undefined}
                    onClick={() => setOpen(s.id)}
                  >
                    <Icon name={s.icon} size={18} />
                    {s.label}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <section className="st-panel" aria-label={section.label}>
          <div className="st-titlebar">
            <h2 className="st-title">{section.label}</h2>
            {section.tip}
            <div className="st-titlebar-end" ref={setTitleEnd} />
          </div>
          {problem ? (
            <p className="st-err st-content" role="alert">
              <Icon name="octagon-alert" size={14} color="var(--red-600)" /> {problem}
            </p>
          ) : (
            <div className="st-content">{section.render(settings, setSettings, titleEnd)}</div>
          )}
        </section>
      </div>
    </div>
  )
}
