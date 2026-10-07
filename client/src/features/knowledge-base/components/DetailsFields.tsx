// A knowledge document's details form: source type first, then only the
// details that type needs. Used by the Edit details dialog (KB-01), where a
// detail auto-labelling could not confirm opens empty and marked (IN-05).
import { Input, Select } from '../../../design-system'
import { FACILITY_TYPES, JURISDICTIONS } from '../../assessments/demo-data'
import type { DocumentDetails, SourceType, UnconfirmedDetail } from '../api'
import { editionProblem, FACILITY_UNSET } from '../details'

const SOURCE_OPTIONS = [
  { value: '', label: 'Choose a source type' },
  { value: 'fm_standard', label: 'FM standard' },
  { value: 'nfpa_standard', label: 'NFPA standard' },
  { value: 'marsh_report', label: 'Marsh report' },
]
// A standard may apply everywhere; a past report is about one country and one
// facility type, so it has no "all" choice.
const STANDARD_COUNTRIES = [{ value: 'all', label: 'All countries' }, ...JURISDICTIONS]
const STANDARD_FACILITIES = [{ value: '', label: 'All facility types' }, ...FACILITY_TYPES]
const REPORT_FACILITIES = [{ value: '', label: 'Choose a facility type' }, ...FACILITY_TYPES]

// The marker under a field that is Unconfirmed and still empty (IN-05).
const unconfirmedHint = <span className="kb-unconfirmed-hint">Unconfirmed — fill this in</span>

/** Returns the details fields for the chosen source type, each with its error. */
export function DetailsFields({
  details,
  errors,
  unconfirmed = [],
  onChange,
}: {
  details: DocumentDetails
  // The gateway's reason per field, e.g. { facilityType: '…' }.
  errors: Record<string, string>
  // The details still Unconfirmed; each is marked while it is empty.
  unconfirmed?: UnconfirmedDetail[]
  onChange: (change: Partial<DocumentDetails>) => void
}) {
  const standard = details.sourceType === 'fm_standard' || details.sourceType === 'nfpa_standard'
  const hint = (name: UnconfirmedDetail, value: string) =>
    unconfirmed.includes(name) && (value === '' || value === FACILITY_UNSET)
      ? unconfirmedHint
      : undefined
  // A blank first choice, so an empty country doesn't look like the first one.
  const countries = (list: { value: string; label: string }[]) =>
    details.jurisdiction === '' ? [{ value: '', label: 'Choose a country' }, ...list] : list
  const facilities = standard
    ? [
        ...(details.facilityType === FACILITY_UNSET
          ? [{ value: FACILITY_UNSET, label: 'Choose a facility type' }]
          : []),
        ...STANDARD_FACILITIES,
      ]
    : REPORT_FACILITIES
  return (
    <div className="kb-fields">
      <Select
        label="Source type"
        required
        options={SOURCE_OPTIONS}
        value={details.sourceType}
        error={errors.sourceType}
        hint={hint('sourceType', details.sourceType)}
        onChange={(e) => onChange({ sourceType: e.target.value as SourceType | '' })}
      />
      {details.sourceType && (
        <>
          <Input
            label="Title"
            required
            value={details.title}
            error={errors.title}
            hint={hint('title', details.title)}
            onChange={(e) => onChange({ title: e.target.value })}
          />
          {standard && (
            <Input
              label="Edition"
              required
              type="number"
              // min/max only steer the arrows; editionProblem does the real
              // check once four digits are in, and before sending.
              min={1900}
              max={new Date().getFullYear() + 1}
              step={1}
              placeholder="e.g. 2022"
              value={details.edition}
              hint={hint('edition', details.edition)}
              error={(details.edition.length === 4 && editionProblem(details)) || errors.edition}
              onChange={(e) => onChange({ edition: e.target.value.replace(/\D/g, '').slice(0, 4) })}
            />
          )}
          <Input
            label={standard ? 'Effective date' : 'Report date'}
            type="date"
            required
            value={details.effectiveDate}
            error={errors.effectiveDate}
            hint={hint('effectiveDate', details.effectiveDate)}
            onChange={(e) => onChange({ effectiveDate: e.target.value })}
          />
          <Select
            label="Country"
            required
            options={countries(standard ? STANDARD_COUNTRIES : JURISDICTIONS)}
            value={details.jurisdiction}
            error={errors.jurisdiction}
            hint={hint('jurisdiction', details.jurisdiction)}
            onChange={(e) => onChange({ jurisdiction: e.target.value })}
          />
          <Select
            label="Facility type"
            required={!standard}
            options={facilities}
            value={
              standard
                ? details.facilityType
                : details.facilityType === FACILITY_UNSET
                  ? ''
                  : details.facilityType
            }
            error={errors.facilityType}
            hint={hint('facilityType', details.facilityType)}
            onChange={(e) => onChange({ facilityType: e.target.value })}
          />
        </>
      )}
    </div>
  )
}
