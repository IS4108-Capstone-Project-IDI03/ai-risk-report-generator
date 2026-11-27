// The Details card on a proposed observation's own page (CP-22 round 5; not-sure marks in CP-24
// AC17): Location, Category and Severity as picker fields, stacked as the saved observation's
// Details are (assessments/components/ObservationDetails.tsx). A location, category or severity the
// AI was not sure of shows amber with Confirm and Change; either clears its flag in the proposal
// (proposal.ts updateObservation), saved with the autosave. Used by screens/ProposalPage.tsx.
// Calls ChoicePickerField, RecordCard.
import { ChoicePickerField, Icon, type Choice } from '../../../design-system'
import { CategoryMark, SeverityMark } from '../../assessments/components/ObservationMarks'
import { RecordCard } from '../../assessments/components/RecordCard'
import type { ProposedObservation } from '../api'
import { CATEGORY_OPTIONS, SEVERITY_OPTIONS } from '../options'
import type { ObservationPatch } from '../proposal'
import '../../assessments/observation-page.css'

/** Returns the card: the three fields one under another. */
export function ProposalDetails({
  o,
  locations,
  where,
  canChange,
  onChange,
}: {
  o: ProposedObservation
  locations: Choice[]
  // The chosen location's words, or null while it has none.
  where: string | null
  canChange: boolean
  onChange: (patch: ObservationPatch) => void
}) {
  // Every one is needed before Create all, so an empty one reads red with its "Choose a …"
  // words, as the page always did (review.css [data-needed]); no error line before a failed create.
  const empty = (words: string) => (
    <>
      <Icon name="circle-alert" size={16} color="var(--red-600)" />
      <span className="cpf-text">{words}</span>
    </>
  )
  return (
    <RecordCard title="Details" as="aside" className="cpp-details">
      <div data-needed={(!o.locationRef && canChange) || undefined}>
        <ChoicePickerField
          label="Location"
          choices={locations}
          selected={o.locationRef ? [o.locationRef] : []}
          onChoose={(ref) => onChange({ locationRef: ref || null })}
          value={
            where ? (
              <>
                <Icon name="map-pin" size={16} color="var(--marsh-navy)" />
                <span className="cpf-text">{where}</span>
              </>
            ) : canChange ? (
              empty('Choose a location')
            ) : undefined
          }
          valueLabel={where ?? undefined}
          placeholder="Choose a location"
          notSure={o.check.location}
          onConfirm={() => onChange({ confirm: ['location'] })}
          disabled={!canChange}
        />
      </div>
      <div data-needed={(!o.copeDimension && canChange) || undefined}>
        <ChoicePickerField
          label="Category"
          choices={CATEGORY_OPTIONS}
          selected={o.copeDimension ? [o.copeDimension] : []}
          onChoose={(cat) =>
            onChange({ copeDimension: cat as ProposedObservation['copeDimension'] })
          }
          value={
            o.copeDimension ? (
              <>
                <CategoryMark cats={[o.copeDimension]} />
                <span className="cpf-text">{o.copeDimension}</span>
              </>
            ) : canChange ? (
              empty('Choose a category')
            ) : undefined
          }
          valueLabel={o.copeDimension ?? undefined}
          placeholder="Choose a category"
          notSure={o.check.category}
          onConfirm={() => onChange({ confirm: ['category'] })}
          disabled={!canChange}
        />
      </div>
      <div data-needed={(!o.severity && canChange) || undefined}>
        <ChoicePickerField
          label="Severity"
          choices={SEVERITY_OPTIONS}
          selected={o.severity ? [o.severity] : []}
          onChoose={(sev) => onChange({ severity: sev as ProposedObservation['severity'] })}
          value={
            o.severity ? (
              <SeverityMark sev={o.severity} />
            ) : canChange ? (
              empty('Choose a severity')
            ) : undefined
          }
          valueLabel={
            o.severity ? o.severity.charAt(0).toUpperCase() + o.severity.slice(1) : undefined
          }
          placeholder="Choose a severity"
          notSure={o.check.severity}
          onConfirm={() => onChange({ confirm: ['severity'] })}
          disabled={!canChange}
        />
      </div>
    </RecordCard>
  )
}
