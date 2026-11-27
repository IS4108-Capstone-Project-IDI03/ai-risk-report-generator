// "Build your checklist" (CP-37): three plain sections, then one Generate button. Shown before
// a checklist exists and when the engineer presses Regenerate. Called by screens/Checklist.tsx.
import { useState } from 'react'
import { Button, Checkbox } from '../../../design-system'
import type { ChecklistChoice, ChecklistView, ScopeStandard } from '../api'
import { Tip } from '../../help/Tip'
import { PickList } from './PickList'
import '../checklist.css'

// "NFPA 13 · 2025 · Sprinkler Systems" from what the knowledge base knows of a standard.
function standardLabel(s: ScopeStandard) {
  const name = [s.issuingBody, s.standardNumber].filter(Boolean).join(' ')
  const detail = [name, s.edition].filter(Boolean).join(' · ')
  return detail ? `${s.title} (${detail})` : s.title
}

// The standards ticked at the start: all, except those the latest checklist left out (unless
// added to the knowledge base since it was generated).
function startingStandards(view: ChecklistView) {
  const last = view.checklist
  const generated = last && new Date(last.provenance.generated_at)
  return new Set(
    view.standards
      .filter(
        (s) =>
          !last || last.standards.some((u) => u.id === s.id) || new Date(s.uploadedAt) > generated!,
      )
      .map((s) => s.id),
  )
}

/** Returns the selection view; onGenerate gets the body the gateway takes. */
export function ChecklistBuild({
  view,
  running,
  note,
  onGenerate,
  onCancel,
}: {
  view: ChecklistView
  running: boolean
  // A line above the sections, e.g. what regenerating keeps.
  note?: string
  onGenerate: (choice: ChecklistChoice) => void
  onCancel?: () => void
}) {
  const [standards, setStandards] = useState(() => startingStandards(view))
  const [reports, setReports] = useState(() => new Set((view.pastReports ?? []).map((r) => r.id)))
  const [includeDefaults, setIncludeDefaults] = useState(true)
  return (
    <div className="cl-build">
      <h2>Build your checklist</h2>
      {note && <p className="cl-note">{note}</p>}
      {view.defaults && (
        <section>
          <h3>Defaults</h3>
          <Checkbox
            label={`Include the fixed questions set by your admin (${view.defaults.count} for ${view.scope.facilityType})`}
            checked={includeDefaults}
            disabled={running}
            onChange={setIncludeDefaults}
          />
        </section>
      )}
      <section data-walk="checklist.standards">
        <h3>
          Codes and standards <Tip id="checklist.standards" />
        </h3>
        {view.standards.length === 0 ? (
          <p className="cl-note">No standards in the knowledge base apply to this site.</p>
        ) : (
          <PickList
            label="Codes and standards"
            options={view.standards.map((s) => ({ id: s.id, label: standardLabel(s) }))}
            picked={standards}
            onChange={setStandards}
            disabled={running}
          />
        )}
      </section>
      {view.pastReports && (
        <section>
          <h3>Past Marsh reports</h3>
          {view.pastReports.length === 0 ? (
            <p className="cl-note">No past Marsh reports match this site type and country.</p>
          ) : (
            <PickList
              label="Past Marsh reports"
              options={view.pastReports.map((r) => ({ id: r.id, label: r.title }))}
              picked={reports}
              onChange={setReports}
              disabled={running}
            />
          )}
        </section>
      )}
      <div className="cl-build-actions">
        <Button
          variant="primary"
          pill
          iconLeft="sparkles"
          loading={running}
          disabled={running}
          data-walk="checklist.generate"
          onClick={() =>
            onGenerate({
              standardIds: [...standards],
              pastReportIds: [...reports],
              includeDefaults,
            })
          }
        >
          Generate checklist
        </Button>
        {onCancel && (
          <Button variant="pill" disabled={running} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {running && (
        <p className="cl-note">Generating the checklist. This takes about half a minute.</p>
      )}
    </div>
  )
}
