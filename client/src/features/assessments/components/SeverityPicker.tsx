import { useId } from 'react'
import type { CSSProperties } from 'react'

// The report's four-step severity scale, most severe first.
const SEVERITIES = ['critical', 'high', 'moderate', 'low']

// An observation's severity, chosen from four chips that are native radios,
// at least 44px tall for gloved hands. Capture and the Edit dialog share it,
// so grading looks the same wherever it is set. '' leaves none chosen.
export function SeverityPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const name = useId()
  return (
    // Four across, or two by two where that is too narrow (workflow.css).
    <div className="severity-picker">
      <fieldset
        style={{
          margin: 0,
          padding: 0,
          border: 'none',
          minWidth: 0,
          fontFamily: 'var(--font-sans)',
        }}
      >
        <legend
          style={{
            padding: 0,
            marginBottom: 'var(--space-3)',
            fontSize: 'var(--text-small-size)',
            lineHeight: 'var(--text-small-lh)',
            fontWeight: 'var(--weight-medium)',
            color: 'var(--text-body)',
          }}
        >
          {'Severity'}
        </legend>
        <div className="severity-chips">
          {SEVERITIES.map((severity) => (
            <label key={severity} className="ds-choice" style={chip(value === severity, severity)}>
              <input
                type="radio"
                name={name}
                value={severity}
                checked={value === severity}
                onChange={() => onChange(severity)}
              />
              {severity.charAt(0).toUpperCase() + severity.slice(1)}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}

// A chip in its severity's colours once chosen.
function chip(on: boolean, tone: string): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '44px',
    padding: '0 4px',
    borderRadius: '5px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background 120ms cubic-bezier(.2,0,.2,1)',
    border: '1px solid ' + (on ? 'var(--status-' + tone + '-fg)' : 'var(--border-default)'),
    background: on ? 'var(--status-' + tone + '-bg)' : 'var(--surface-card)',
    color: on ? 'var(--status-' + tone + '-fg)' : 'var(--text-secondary)',
  }
}
