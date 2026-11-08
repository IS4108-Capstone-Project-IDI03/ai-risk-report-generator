// The New Assessment form (CP-23 AC5, AC10, AC12, AC17-AC20, boards 08, 09,
// 12, 13): New client | Existing client, the client card, a recorded client's
// Sites card, one card per site, and "Add site". After a refused Create it
// glides to the first missing field (motion 1). Used by
// screens/NewAssessment.tsx. Calls useNewAssessment.ts's state and actions.
import { useEffect, useRef } from 'react'
import { AddRow, Callout, SegmentedControl } from '../../../design-system'
import { Block, FormOpened } from '../components/Block'
import { ClientCard } from '../components/ClientCard'
import { SiteCard } from '../components/SiteCard'
import { SitesPicker } from '../components/SitesPicker'
import type { IntakeFile } from '../api'
import type { ClientMode } from '../form'
import { scrollToField } from '../scrollToField'
import type { NewAssessmentForm as Form } from '../useNewAssessment'

const MODES = [
  { value: 'new' as const, label: 'New client', icon: 'building' },
  { value: 'existing' as const, label: 'Existing client', icon: 'building-2' },
]

export function NewAssessmentForm({
  f,
  enter,
  readNothing,
  rejected,
}: {
  f: Form
  // Fresh from reading: the cards fade and rise in, 40 ms apart (motion 5).
  enter: boolean
  readNothing: boolean
  // The files refused or failed to read, for the Rejected pill; none if filled in by hand.
  rejected: IntakeFile[]
}) {
  const { form } = f
  const root = useRef<HTMLDivElement>(null)
  // Fresh from reading: start at the top (the reading screen may have been
  // scrolled), and put focus on the first Not sure field, else the page title,
  // so a keyboard or screen-reader user lands on what needs a look.
  useEffect(() => {
    const el = root.current
    if (!enter || !el) return
    const scroller = el.closest<HTMLElement>('.om-scroll')
    if (scroller) scroller.scrollTop = 0
    const title = el.closest('.na')?.querySelector<HTMLElement>('.na-topbar h1')
    if (title) title.tabIndex = -1
    const first = el.querySelector<HTMLElement>('.na-field.is-unsure :is(input, select)') ?? title
    first?.focus({ preventScroll: true })
  }, [enter])
  // Each refused Create goes to the first field with an error line.
  useEffect(() => {
    if (!f.refused) return
    const first = document.querySelector<HTMLElement>('.na-form [data-error]')
    if (first) scrollToField(first)
    // A field shakes only when Create is pressed again while its error is still there (board
    // 17 · 10): the first refusal marks it, a later one shakes. The class is removed and the
    // layout read so the animation restarts.
    document.querySelectorAll<HTMLElement>('.na-form [data-error]').forEach((el) => {
      // Only the outer field shakes; an error line inside it moves with it.
      if (el.dataset.seen && !el.parentElement?.closest('[data-error]')) {
        el.classList.remove('ds-shake')
        void el.offsetWidth
        el.classList.add('ds-shake')
      }
      el.dataset.seen = '1'
    })
  }, [f.refused])
  // Blocks added after this first render animate in (components/Block.tsx).
  const opened = useRef(false)
  useEffect(() => {
    opened.current = true
  }, [])
  const chosen = form.clientMode === 'new' || !!form.client.id
  return (
    <FormOpened.Provider value={opened}>
      <div ref={root} className={'na-form' + (enter ? ' na-enter' : '')}>
        {readNothing && (
          <Callout tone="info">
            {
              'Nothing could be read from these documents. Fill in the form, or add other documents.'
            }
          </Callout>
        )}
        <div className="na-mode">
          <SegmentedControl<ClientMode>
            ariaLabel="Client"
            options={MODES}
            value={form.clientMode}
            onChange={f.setClientMode}
          />
        </div>
        <ClientCard f={f} rejected={rejected} />
        {form.clientMode === 'existing' && !!form.client.id && <SitesPicker f={f} />}
        {chosen &&
          form.sites.map((site, i) => (
            <Block key={site.ref}>
              <SiteCard f={f} i={i} site={site} />
            </Block>
          ))}
        {form.clientMode === 'new' && <AddRow onClick={f.addSite}>{'Add site'}</AddRow>}
      </div>
    </FormOpened.Provider>
  )
}
