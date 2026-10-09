// EV-01: shows the evidence and structure checks of a draft, with a Run button.
// Rendered by AssessmentApp on the Export tab. Calls runEvaluation / latestEvaluation in api.ts.
import { useEffect, useState } from 'react'
import { Button, Callout } from '../../../design-system'
import { GatewayError, latestEvaluation, runEvaluation, type EvaluationRun } from '../api'

// Colours per result; unverified is grey so it never looks like a pass.
const COLOUR: Record<string, string> = {
  pass: 'var(--status-low-fg)',
  fail: 'var(--status-high-fg)',
  warn: 'var(--status-moderate-fg)',
  unverified: 'var(--text-muted)',
}

// reference is null for the built-in sample assessment, which has no saved draft to check.
export function EvidenceChecks({ reference }: { reference: string | null }) {
  const [run, setRun] = useState<EvaluationRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!reference) return
    latestEvaluation(reference).then(setRun, () => setRun(null))
  }, [reference])

  async function runNow() {
    if (!reference) return
    setBusy(true)
    setError(null)
    try {
      setRun(await runEvaluation(reference))
    } catch (e) {
      setError(
        e instanceof GatewayError && e.status === 403
          ? 'Only the assigned engineer can run the checks.'
          : 'The checks could not be run.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '24px 28px 0', maxWidth: '1080px' }}>
      <div
        style={{
          background: 'var(--surface-card)',
          border: '1px solid var(--border-default)',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 20px' }}>
          <span style={{ fontSize: '19px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Evidence checks
          </span>
          {run && (
            <span style={{ fontSize: '14px', color: 'var(--text-muted)' }}>
              {run.summary.passed} passed · {run.summary.failed} failed · {run.summary.warned}{' '}
              warnings · {run.summary.unverified} unverified
            </span>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="secondary" size="sm" onClick={runNow} disabled={busy || !reference}>
            {busy ? 'Checking…' : run ? 'Run again' : 'Run checks'}
          </Button>
        </div>
        {error && (
          <div style={{ padding: '0 20px 12px' }}>
            <Callout tone="danger" title={error}>
              {''}
            </Callout>
          </div>
        )}
        {run?.checks.map((c, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              gap: '12px',
              padding: '10px 20px',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: '15px',
            }}
          >
            <strong style={{ width: '90px', color: COLOUR[c.result] }}>{c.result}</strong>
            <span style={{ width: '170px', color: 'var(--text-muted)' }}>
              {c.check} · s{c.sectionId}
            </span>
            <span style={{ flex: 1, minWidth: 0, color: 'var(--text-body)' }}>
              {c.target}
              {c.detail ? ` — ${c.detail}` : ''}
            </span>
          </div>
        ))}
        {!run && !error && (
          <p style={{ margin: 0, padding: '0 20px 16px', color: 'var(--text-muted)' }}>
            {reference
              ? 'No checks have been run for this report yet.'
              : 'This is the sample assessment. Open a saved assessment from your work list to run the checks.'}
          </p>
        )}
      </div>
    </div>
  )
}
