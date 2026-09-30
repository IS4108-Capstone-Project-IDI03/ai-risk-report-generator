// A knowledge document's details form: source type first, then only the
// details that type needs (IN-01 AC1). Shared by an upload row
// (KnowledgeBase.tsx) and the Edit details dialog (KnowledgeDocuments.tsx,
// KB-01), so both ask the same things in the same way.
import { Input, Select } from '../../design-system'
import { FACILITY_TYPES, JURISDICTIONS } from '../assessments/demo-data'
import type { DocumentDetails, SourceType } from './api'
import { editionProblem } from './uploads'

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

/** Returns the details fields for the chosen source type, each with its error. */
export function DetailsFields({
  details,
  errors,
  onChange,
}: {
  details: DocumentDetails
  // The gateway's reason per field, e.g. { facilityType: '…' }.
  errors: Record<string, string>
  onChange: (change: Partial<DocumentDetails>) => void
}) {
  const standard = details.sourceType === 'fm_standard' || details.sourceType === 'nfpa_standard'
  return (
    <div className="kb-fields">
      <Select
        label="Source type"
        required
        options={SOURCE_OPTIONS}
        value={details.sourceType}
        error={errors.sourceType}
        onChange={(e) => onChange({ sourceType: e.target.value as SourceType | '' })}
      />
      {details.sourceType && (
        <>
          <Input
            label="Title"
            required
            value={details.title}
            error={errors.title}
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
            onChange={(e) => onChange({ effectiveDate: e.target.value })}
          />
          <Select
            label="Country"
            required
            options={standard ? STANDARD_COUNTRIES : JURISDICTIONS}
            value={details.jurisdiction}
            error={errors.jurisdiction}
            onChange={(e) => onChange({ jurisdiction: e.target.value })}
          />
          <Select
            label="Facility type"
            required={!standard}
            options={standard ? STANDARD_FACILITIES : REPORT_FACILITIES}
            value={details.facilityType}
            error={errors.facilityType}
            onChange={(e) => onChange({ facilityType: e.target.value })}
          />
        </>
      )}
    </div>
  )
}
