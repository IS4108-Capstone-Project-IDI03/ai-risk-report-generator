// A date field of the New Assessment form (CP-23 round 1, boards 08, 19): the design
// system's DatePicker in v2's Not sure and error states. Used by AssessmentBlock.tsx.
// Calls DatePicker; the wording of the error comes from validate.ts.
import { useId } from 'react'
import { DatePicker, Icon } from '../../../design-system'

/** Returns a dd/mm/yyyy date field (ISO value) with the form's Not sure tint and error line. */
export function DateField({
  label,
  value,
  onChange,
  min,
  required,
  notSure,
  error,
}: {
  label: string
  value: string
  // `invalid`: the typed text is not a real date (iso is then '').
  onChange: (iso: string, invalid: boolean) => void
  min?: string
  required?: boolean
  notSure?: boolean
  error?: string
}) {
  const hintId = useId()
  const unsure = notSure && !error
  return (
    <div
      className={'na-field na-field--datepicker' + (unsure ? ' is-unsure' : '')}
      data-error={error ? '' : undefined}
    >
      <DatePicker
        label={label}
        required={required}
        value={value}
        min={min}
        error={error}
        describedBy={unsure ? hintId : undefined}
        onChange={(iso, info) => onChange(iso, !!info.invalid)}
      />
      {unsure && (
        <>
          <span className="na-unsure-icon" role="img" aria-label="Not sure">
            <Icon name="triangle-alert" size={16} />
          </span>
          <span id={hintId} className="na-sr-only">
            {'Not sure, check it'}
          </span>
        </>
      )}
    </div>
  )
}
