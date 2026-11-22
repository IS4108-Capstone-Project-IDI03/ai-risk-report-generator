// An observation's Details card on its page (CP-06, CP-22, CP-24): Location, Category and Severity
// as picker fields with their icons, saved as soon as chosen, then the edited and deleted stamps.
// A category or severity the AI suggested shows its state: suggesting (blue), not sure (amber, with
// Confirm and Change), or failed (red, one "Suggestion failed" line with Try again). Whoever cannot
// change the observation sees the marks and no actions. Rendered by screens/ObservationPage.tsx.
// Calls ChoicePickerField, RecordCard, FailedLine.
import { useEffect, useRef, type ReactNode } from 'react'
import { FailedLine, Icon } from '../../../design-system'
import { Tip } from '../../help/Tip'
import { CATEGORY_OPTIONS, SEVERITY_OPTIONS } from '../../site-walk/options'
import { toggleCategory, UNCATEGORISED_HINT } from '../categories'
import type { ObservationChange } from '../useAssessmentWorkflow'
import type { ObservationRowView } from '../useObservationsView'
import { type Choice } from './ChoiceMenu'
import { ChoicePickerField } from './ChoicePickerField'
import { CategoryMark, SeverityMark } from './ObservationMarks'
import { RecordCard } from './RecordCard'

type Field = 'category' | 'severity'

// What the card reads from the row: the values, who may change them, and the suggestion's state.
export type DetailsView = Pick<
  ObservationRowView,
  | 'canChange'
  | 'cats'
  | 'catLabel'
  | 'sev'
  | 'sevLabel'
  | 'locationId'
  | 'where'
  | 'path'
  | 'suggestion'
  | 'retrySuggestion'
>

/** Returns the Details card; `stamps` are its "Edited by" / "Deleted by" lines. */
export function ObservationDetails({
  o,
  locations,
  save,
  onConfirmed,
  stamps,
}: {
  o: DetailsView
  locations: Choice[]
  save: (change: ObservationChange) => Promise<boolean>
  // Says a field was confirmed (the page shows the toast).
  onConfirmed: (field: Field) => void
  stamps: ReactNode
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
    const next = toggleCategory(chosen.current, cat)
    chosen.current = next
    pending.current++
    const ok = await save({ cats: next })
    pending.current--
    if (!ok) chosen.current = o.cats
  }
  async function confirm(field: Field) {
    if (await save({ confirm: [field] })) onConfirmed(field)
  }

  // A field's state, from the observation's stored suggestion (CP-24). Empty, or still an
  // unconfirmed suggestion, while the AI is reading: waiting. Empty after it failed: red.
  const s = o.suggestion
  const state = (field: Field, empty: boolean) => {
    const mine = field === 'category' ? s?.category : s?.severity
    const open = empty || !!mine
    return {
      suggesting: s?.status === 'reading' && open,
      failed: s?.status === 'failed' && empty,
      notSure: !empty && !!mine?.notSure && s?.status !== 'reading',
    }
  }
  const cat = state('category', !o.cats.length)
  const sev = state('severity', !o.sev)
  // The line shows whenever the suggestion failed, even with older suggested values still filled
  // in (a re-reading can fail): without it the observation would be out of drafting with no way
  // to retry. Only empty fields turn red.
  const failed = s?.status === 'failed'

  return (
    <RecordCard title="Details" as="aside" className="cpp-details">
      <ChoicePickerField
        label="Location"
        valueLabel={o.where}
        value={
          <>
            <Icon name="map-pin" size={16} color="var(--marsh-navy)" />
            {/* The name alone: the header over the page already says the building and level. */}
            <span className="cpf-text">{o.path?.name ?? o.where}</span>
          </>
        }
        disabled={!can}
        choices={locations}
        selected={[o.locationId ?? '']}
        onChoose={(locationId) => void save({ locationId })}
      />
      <ChoicePickerField
        label="Category"
        valueLabel={o.cats.length ? o.catLabel : undefined}
        placeholder="Choose a category"
        value={
          o.cats.length ? (
            <>
              <CategoryMark cats={o.cats} />
              <span className="cpf-text">{o.catLabel}</span>
            </>
          ) : undefined
        }
        suggesting={cat.suggesting ? 'Suggesting a category' : undefined}
        notSure={cat.notSure}
        failed={cat.failed}
        disabled={!can}
        help={<Tip id="observation.suggested" />}
        confirmWalk={cat.notSure ? 'observation.confirm' : undefined}
        onConfirm={() => void confirm('category')}
        multiple
        choices={CATEGORY_OPTIONS}
        selected={o.cats}
        onChoose={(c) => void toggle(c)}
        hint={UNCATEGORISED_HINT}
      />
      <ChoicePickerField
        label="Severity"
        valueLabel={o.sev ? o.sevLabel : undefined}
        placeholder="Choose a severity"
        value={o.sev ? <SeverityMark sev={o.sev} /> : undefined}
        suggesting={sev.suggesting ? 'Suggesting a severity' : undefined}
        notSure={sev.notSure}
        failed={sev.failed}
        disabled={!can}
        // F-12: the walkthrough presses the first Confirm there is, the category's before the severity's.
        confirmWalk={sev.notSure && !cat.notSure ? 'observation.confirm' : undefined}
        onConfirm={() => void confirm('severity')}
        choices={SEVERITY_OPTIONS}
        selected={[o.sev]}
        onChoose={(value) => void save({ sev: value })}
      />
      {/* One line under both fields (motion 5). View only: no Try again. */}
      {failed && (
        <FailedLine message="Suggestion failed" onAction={o.retrySuggestion ?? undefined} />
      )}
      {/* The stamps under a hairline, as the client page's details are. */}
      {stamps}
    </RecordCard>
  )
}
