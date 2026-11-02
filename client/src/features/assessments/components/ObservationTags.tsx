// An observation's tags, edited in place on its page (CP-06, CP-22): its COPE
// categories, its severity (required) and its location, each our own menu,
// saved as soon as it is chosen, in a row of equal widths. The category menu
// also holds Suggest categories. Rendered by screens/ObservationPage.tsx, and by
// a site walk proposal's observation page (site-walk/screens/ProposalPage.tsx).
import { useEffect, useRef, type ReactNode } from 'react'
import { Icon, IconRegistry } from '../../../design-system'
import { CAT_ICON, COPE_CATEGORIES, toggleCategory, UNCATEGORISED_HINT } from '../categories'
import type { ObservationChange } from '../useAssessmentWorkflow'
import type { ObservationRowView } from '../useObservationsView'
import { ChoiceMenu, type Choice } from './ChoiceMenu'
import { CategoryMark, SeverityMark } from './ObservationMarks'
import '../observation-page.css'

const SEVERITIES: Choice[] = ['critical', 'high', 'moderate', 'low'].map((sev) => ({
  value: sev,
  label: sev.charAt(0).toUpperCase() + sev.slice(1),
  icon: IconRegistry.severity[sev as keyof typeof IconRegistry.severity].icon,
  color: IconRegistry.severity[sev as keyof typeof IconRegistry.severity].color,
}))
// The category menu's first item: asks the AI to read the observation, not a category.
const SUGGEST = 'suggest-categories'
const CATEGORIES: Choice[] = COPE_CATEGORIES.map((cat) => ({
  value: cat,
  label: cat,
  icon: CAT_ICON[cat],
}))

// Just what the tags show, so a proposed observation can fill it too.
export type TagsView = Pick<
  ObservationRowView,
  'canChange' | 'cats' | 'catLabel' | 'sev' | 'sevLabel' | 'locationId' | 'where'
>

export function ObservationTags({
  o,
  locations,
  save,
  suggest,
  stamps,
  proposed = false,
}: {
  o: TagsView
  locations: Choice[]
  save: (change: ObservationChange) => Promise<boolean>
  // Reads the observation for categories to suggest; absent when it cannot.
  suggest?: () => void
  stamps: ReactNode
  // A site walk proposal's observation (round 5): one category, as the proposal
  // stores it, and every tag needed before Create all, so an empty one shows red.
  proposed?: boolean
}) {
  const can = o.canChange
  // The categories as last clicked, saved or not: without this, a quick second click
  // builds on the server's older list and drops the first one.
  const chosen = useRef(o.cats)
  // Saves still on their way: until they are all answered, an earlier answer
  // must not reset the list, or a click queued behind it would be dropped.
  const pending = useRef(0)
  useEffect(() => {
    if (!pending.current) chosen.current = o.cats
  }, [o.cats])
  async function toggle(cat: string) {
    const next = proposed ? [cat] : toggleCategory(chosen.current, cat)
    chosen.current = next
    pending.current++
    const ok = await save({ cats: next })
    pending.current--
    if (!ok) chosen.current = o.cats
  }
  // The category menu's own toggle, kept so choosing Suggest categories can
  // close it: a multi-choice menu otherwise stays open under the result.
  const closeMenu = useRef<() => void>(() => {})
  const categoryChoices: Choice[] =
    can && suggest
      ? [{ value: SUGGEST, label: 'Suggest categories', icon: 'sparkles' }, ...CATEGORIES]
      : CATEGORIES
  return (
    <aside className="ob-card op-fields" aria-label="Tags">
      {/* Category and Severity hold short words, Location a long path: the
          grid gives Location the room (observation-page.css). */}
      <div className="op-fields-grid">
        <Tag label="Category">
          <ChoiceMenu
            label="Category"
            className="op-menu"
            multiple={!proposed}
            choices={categoryChoices}
            selected={o.cats}
            onChoose={(cat) => {
              if (cat !== SUGGEST) return void toggle(cat)
              closeMenu.current()
              suggest?.()
            }}
            // A proposal can't be added uncategorised, so the tab's hint would mislead.
            hint={proposed ? undefined : UNCATEGORISED_HINT}
            trigger={(_, toggleMenu) => {
              closeMenu.current = toggleMenu
              return (
                <Picker
                  label="Category"
                  value={o.catLabel}
                  can={can}
                  empty={proposed && !o.cats.length}
                  onClick={toggleMenu}
                >
                  <CategoryMark cats={o.cats} />
                  <span>{o.catLabel}</span>
                </Picker>
              )
            }}
          />
        </Tag>
        <Tag label="Severity" required>
          <ChoiceMenu
            label="Severity"
            className="op-menu"
            choices={SEVERITIES}
            selected={[o.sev]}
            onChoose={(sev) => void save({ sev })}
            trigger={(_, toggle) => (
              <Picker
                label="Severity"
                value={o.sevLabel}
                can={can}
                empty={proposed && !o.sev}
                onClick={toggle}
              >
                <SeverityMark sev={o.sev} />
              </Picker>
            )}
          />
        </Tag>
        <Tag label="Location">
          <ChoiceMenu
            label="Location"
            className="op-menu"
            choices={locations}
            selected={[o.locationId ?? '']}
            onChoose={(locationId) => void save({ locationId })}
            trigger={(_, toggle) => (
              <Picker
                label="Location"
                value={o.where}
                can={can}
                empty={proposed && !o.locationId}
                onClick={toggle}
              >
                <Icon name="map-pin" size={16} color="var(--marsh-navy)" />
                <span>{o.where}</span>
              </Picker>
            )}
          />
        </Tag>
        {stamps}
      </div>
    </aside>
  )
}

function Tag({
  label,
  required = false,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <div>
      <span className="ob-tag-label" aria-hidden="true">
        {label}
        {required && <span className="ob-required">{'*'}</span>}
      </span>
      {children}
    </div>
  )
}

// The button showing a tag's value (its children); it opens the menu only
// for whoever may change the observation. An empty one that is needed shows
// a red alert and its value's words ("Choose a severity") instead.
function Picker({
  label,
  value,
  can,
  empty = false,
  onClick,
  children,
}: {
  label: string
  value: string
  can: boolean
  empty?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="ob-picker"
      data-empty={empty || undefined}
      aria-label={label + ': ' + value + (can ? '. Change' : '')}
      // The whole value on hover, when the field cuts it short.
      title={value}
      disabled={!can}
      onClick={onClick}
    >
      {empty ? (
        <>
          <Icon name="circle-alert" size={16} color="var(--red-600)" />
          <span>{value}</span>
        </>
      ) : (
        children
      )}
      {can && (
        <Icon
          name="chevron-down"
          size={16}
          color="var(--text-secondary)"
          style={{ marginLeft: 'auto' }}
        />
      )}
    </button>
  )
}
