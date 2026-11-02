import { useId } from 'react'
import type { CSSProperties } from 'react'
import { Icon, IconRegistry } from '../../../design-system'

// Read by screen readers, not shown.
const SR_ONLY: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
}
// The report's four-step severity scale, most severe first.
const SEVERITIES = ['critical', 'high', 'moderate', 'low']

// An observation's severity, chosen from four chips that are native radios,
// at least 44px tall for gloved hands, each with its symbol in its colour and
// a red asterisk marking it required. Used by capture. '' leaves none chosen.
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
          {/* Required: an observation is always graded (CP-02). */}
          <span aria-hidden="true" style={{ color: 'var(--red-600)', marginLeft: '2px' }}>
            {'*'}
          </span>
          <span style={SR_ONLY}>{' (required)'}</span>
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
              {/* Each in its own colour, chosen or not, as the list shows it. */}
              <Icon
                name={IconRegistry.severity[severity as keyof typeof IconRegistry.severity].icon}
                size={15}
                color={'var(--status-' + severity + '-fg)'}
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
    gap: '6px',
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
