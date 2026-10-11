import { useState } from 'react'
import { Button, Callout, EmptyState, IconRegistry } from '../../../design-system'
import {
  bulkAccept,
  decideFinding,
  decideReplacement,
  editFinding,
  regenerateSection,
  type ReviewSection,
  type ReviewWorkspace as Workspace,
} from '../api'
import { DraftEditor, type FindingActions } from '../components/DraftEditor'
import { OfiBlock } from '../components/OfiSuggestions'
import {
  AcceptReplacementDialog,
  EditFindingDialog,
  RegenerateDialog,
  RejectFindingDialog,
} from '../components/ReviewDialogs'
import { ReviewHistory } from '../components/ReviewHistory'
import { ReviewSectionRail } from '../components/ReviewSectionRail'
import { SectionReviewBar, type DraftView } from '../components/SectionReviewBar'
import { SourcePanel } from '../components/SourcePanel'
import { citationNumbers, describeCitation, type Claim, type ReviewFocus } from '../reviewDisplay'
import { formatDayTime } from '../format'
import { useObservations } from '../useObservations'
import { useOfis } from '../useOfis'
import { useReview } from '../useReview'
import '../review.css'

const NOTHING: ReviewFocus = { citation: null, statement: null }

// The dialog open over the workspace, if any.
type OpenDialog =
  { kind: 'edit' | 'reject'; claim: Claim } | { kind: 'regenerate' | 'accept-replacement' }

// A replacement draft shown in the editor and source panel in place of the
// saved one, read-only: decisions are made on it once it is accepted.
function replacementView(section: ReviewSection): ReviewSection {
  const replacement = section.replacement!
  const statements = replacement.draft.subsections.flatMap((s) => s.statements)
  return {
    ...section,
    draft: replacement.draft,
    sources: replacement.sources,
    observations: replacement.observations,
    review: {
      state: 'ai_draft',
      unsupportedStatements: statements.filter((s) => !s.supported).length,
      withdrawnSources: Object.values(replacement.sources).filter((p) => p.document?.withdrawnAt)
        .length,
      changesSinceDraft: 0,
      changeCounts: { added: 0, changed: 0, removed: 0 },
    },
  }
}

// The Review tab for a saved assessment (RV-01): sections 7-12 down the side
// with their completion and review states, the selected section's draft in
// the middle, and its sources, original observations and claims beside it.
// Section 3 (GN-05) shows the OFIs accepted into the report, in Marsh's tables.
// The assigned engineer accepts, edits and rejects each finding, accepts a
// section's pending findings at once, and regenerates a section as a
// replacement to accept or discard (RV-02); the review summary in the rail
// counts the saved decisions, and each section's review history beside it.
export function ReviewWorkspace({
  reference,
  canReview = false,
  wrapStyle,
  railStyle,
  panelStyle,
  onGenerate,
}: {
  reference: string
  // The assigned engineer, on an assessment not archived: others only read.
  canReview?: boolean
  wrapStyle: React.CSSProperties
  railStyle: React.CSSProperties
  panelStyle: React.CSSProperties
  onGenerate: () => void
}) {
  const { workspace, loadError, keep, reload } = useReview(reference)
  const { ofis } = useOfis(reference)
  // For each OFI's sources, as on Generation.
  const { observations } = useObservations(reference, true)
  // Only a list from the gateway counts; anything else reads as no OFIs yet.
  const accepted = Array.isArray(ofis?.accepted) ? ofis.accepted : []
  const waiting = Array.isArray(ofis?.suggestions) ? ofis.suggestions.length : 0
  const [selected, setSelected] = useState<string | null>(null)
  const [focus, setFocus] = useState<ReviewFocus>(NOTHING)
  const [view, setView] = useState<DraftView>('saved')
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  // The decision being saved: a finding's key, 'bulk' or 'discard'.
  const [busy, setBusy] = useState<string | null>(null)
  // Why the last decision made outside a dialog was not saved.
  const [problem, setProblem] = useState<string | null>(null)
  // Sections being regenerated, and why a regeneration failed, by section.
  const [regenerating, setRegenerating] = useState<Set<string>>(new Set())
  const [regenerateProblems, setRegenerateProblems] = useState<Record<string, string>>({})

  const sections = workspace?.sections
  if (loadError && !sections)
    return (
      <div style={{ padding: '24px 28px' }}>
        <Callout tone="danger" title="The review workspace could not be loaded">
          {loadError}
        </Callout>
      </div>
    )
  if (!sections)
    return <p style={{ padding: '24px 28px', margin: 0 }}>Loading the report sections…</p>

  const drafted = sections.filter((s) => s.draft)
  if (!drafted.length)
    return (
      <EmptyState
        icon="file-text"
        title="No sections drafted yet"
        description="Drafted sections appear here for review. Draft them on the Generation tab."
        action={
          <Button variant="primary" iconLeft="sparkles" onClick={onGenerate}>
            Go to Generation
          </Button>
        }
      />
    )

  // The first drafted section opens until another is chosen.
  const index = Math.max(
    0,
    sections.findIndex((s) => s.id === (selected ?? drafted[0].id)),
  )
  const saved = sections[index]
  const showing = view === 'replacement' && saved.replacement ? 'replacement' : 'saved'
  const section = showing === 'replacement' ? replacementView(saved) : saved
  const numbers = section.draft ? citationNumbers(section.draft) : new Map<string, number>()
  const describe = (citation: string) => describeCitation(section, citation)
  const select = (id: string) => {
    setSelected(id)
    setFocus(NOTHING)
    setView('saved')
    setProblem(null)
  }
  const cite = (citation: string | null, statement: string | null) =>
    setFocus({ citation, statement })
  const previous = sections[index - 1]
  const next = sections[index + 1]
  const rail = (
    <ReviewSectionRail
      sections={sections}
      summary={workspace.summary}
      regenerating={regenerating}
      selected={selected === '3' ? '3' : saved.id}
      onSelect={select}
      inReport={accepted.length}
      style={railStyle}
    />
  )

  // Section 3: the OFIs in the report, laid out like a section's draft: the editor
  // bar, the provenance of their drafting, then each OFI in an AI draft box.
  // Accepting more happens on Generation.
  if (selected === '3') {
    const drafted = accepted[0]?.provenance
    return (
      <div style={wrapStyle}>
        {rail}
        <section aria-label="Draft editor" className="om-scroll rv-editor">
          <div className="rv-editor-inner">
            <div className="rv-editor-bar">
              <p className="rv-label">Draft editor · 1 of {sections.length + 1}</p>
              <Button variant="ghost" size="sm" iconLeft="chevron-left" disabled>
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconRight="chevron-right"
                onClick={() => select(sections[0].id)}
              >
                Next
              </Button>
            </div>
            <h2>3. Opportunities for Improvement</h2>
            {!drafted ? (
              <EmptyState
                icon="file-text"
                title="No OFIs in the report yet"
                description="Draft and accept Opportunities for Improvement on the Generation tab."
                action={
                  <Button variant="secondary" iconLeft="sparkles" onClick={onGenerate}>
                    Go to Generation
                  </Button>
                }
              />
            ) : (
              <>
                <p className="rv-provenance">
                  Drafted {formatDayTime(new Date(drafted.generated_at))} · {drafted.model} (
                  {drafted.effort} effort) · prompt {drafted.prompt_version} · config{' '}
                  {drafted.config_version}
                </p>
                {accepted.map((o) => (
                  <OfiBlock
                    key={o.id}
                    ofi={o}
                    number={o.number}
                    observations={observations ?? []}
                  />
                ))}
              </>
            )}
          </div>
        </section>
        <aside aria-label="Section 3 suggestions" className="om-scroll" style={panelStyle}>
          <div className="rv-panel-section">
            <div className="rv-viewer is-empty">
              <p className="rv-muted">
                {waiting
                  ? `${waiting} suggested OFI${waiting === 1 ? ' is' : 's are'} waiting to be accepted.`
                  : 'No suggested OFIs are waiting.'}{' '}
                Each OFI's sources open below it. Suggestions are drafted and accepted on Report
                generation.
              </p>
              <div style={{ marginTop: '12px' }}>
                <Button variant="secondary" size="sm" iconLeft="sparkles" onClick={onGenerate}>
                  Go to Generation
                </Button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    )
  }

  const draftId = saved.draft?.id ?? ''
  const sectionId = saved.id
  // Saves a decision made outside a dialog, showing why if it is refused.
  const decide = async (key: string, save: () => Promise<Workspace>) => {
    setBusy(key)
    setProblem(null)
    try {
      keep(await save())
    } catch (error: unknown) {
      setProblem(error instanceof Error ? error.message : 'The decision was not saved.')
    }
    setBusy(null)
  }
  // Saves a decision made in a dialog: the dialog shows why if it is refused.
  const decideInDialog = async (save: () => Promise<Workspace>) => {
    keep(await save())
    setDialog(null)
  }
  const regenerate = async (instruction: string) => {
    setDialog(null)
    setRegenerating((ids) => new Set(ids).add(sectionId))
    setRegenerateProblems((problems) => {
      const left = { ...problems }
      delete left[sectionId]
      return left
    })
    try {
      keep(await regenerateSection(reference, sectionId, instruction))
    } catch (error: unknown) {
      setRegenerateProblems((problems) => ({
        ...problems,
        [sectionId]: error instanceof Error ? error.message : 'Drafting failed.',
      }))
    }
    setRegenerating((ids) => {
      const left = new Set(ids)
      left.delete(sectionId)
      return left
    })
  }

  const actions: FindingActions | undefined =
    canReview && showing === 'saved' && saved.draft
      ? {
          busy,
          onAccept: (claim) =>
            decide(claim.key, () =>
              decideFinding(reference, sectionId, draftId, claim.key, 'accept'),
            ),
          onEdit: (claim) => setDialog({ kind: 'edit', claim }),
          onReject: (claim) => setDialog({ kind: 'reject', claim }),
        }
      : undefined
  const rejected = new Set(
    saved.draft
      ? saved.draft.subsections.flatMap((sub, i) =>
          sub.statements.flatMap((s, j) => (s.review.state === 'rejected' ? [`${i}.${j}`] : [])),
        )
      : [],
  )

  return (
    <div style={wrapStyle}>
      {rail}
      <DraftEditor
        section={section}
        // Section 3 is the report's first section here, so 7-12 count from 2.
        position={`${index + 2} of ${sections.length + 1}`}
        onPrevious={() => select(previous ? previous.id : '3')}
        onNext={next && (() => select(next.id))}
        onGenerate={onGenerate}
        numbers={numbers}
        focus={focus}
        describe={describe}
        onCite={cite}
        actions={actions}
        header={
          <>
            {problem && (
              <div role="alert">
                <Callout
                  tone="warning"
                  title="Your decision was not saved"
                  actions={
                    <Button
                      variant="secondary"
                      size="sm"
                      iconLeft={IconRegistry.action.regenerate}
                      onClick={() => {
                        setProblem(null)
                        reload()
                      }}
                    >
                      Reload the workspace
                    </Button>
                  }
                >
                  {problem}
                </Callout>
              </div>
            )}
            <SectionReviewBar
              section={saved}
              view={showing}
              onView={(v) => {
                setView(v)
                setFocus(NOTHING)
              }}
              canReview={canReview}
              busy={busy}
              regenerating={regenerating.has(sectionId)}
              regenerateProblem={regenerateProblems[sectionId] ?? null}
              onBulkAccept={() => decide('bulk', () => bulkAccept(reference, sectionId, draftId))}
              onRegenerate={() => setDialog({ kind: 'regenerate' })}
              onAcceptReplacement={() => setDialog({ kind: 'accept-replacement' })}
              onDiscardReplacement={() =>
                decide('discard', async () => {
                  const after = await decideReplacement(
                    reference,
                    sectionId,
                    saved.replacement!.draft.id,
                    'discard',
                  )
                  setView('saved')
                  return after
                })
              }
            />
          </>
        }
      />
      <SourcePanel
        savedObservations={observations}
        section={section}
        numbers={numbers}
        focus={focus}
        describe={describe}
        onCite={cite}
        onShowClaim={(claim) => setFocus((f) => ({ ...f, statement: claim }))}
        style={panelStyle}
      >
        <ReviewHistory
          entries={saved.history}
          savedDraftId={saved.draft?.id ?? null}
          rejected={rejected}
          busy={busy}
          onRestore={
            canReview
              ? (finding) =>
                  decide(finding, () =>
                    decideFinding(reference, sectionId, draftId, finding, 'restore'),
                  )
              : undefined
          }
        />
      </SourcePanel>

      {dialog?.kind === 'edit' && (
        <EditFindingDialog
          claim={dialog.claim}
          onClose={() => setDialog(null)}
          onSave={(text) =>
            decideInDialog(() => editFinding(reference, sectionId, draftId, dialog.claim.key, text))
          }
        />
      )}
      {dialog?.kind === 'reject' && (
        <RejectFindingDialog
          claim={dialog.claim}
          onClose={() => setDialog(null)}
          onReject={() =>
            decideInDialog(() =>
              decideFinding(reference, sectionId, draftId, dialog.claim.key, 'reject'),
            )
          }
        />
      )}
      {dialog?.kind === 'regenerate' && (
        <RegenerateDialog
          section={saved}
          onClose={() => setDialog(null)}
          onRegenerate={regenerate}
        />
      )}
      {dialog?.kind === 'accept-replacement' && saved.replacement && (
        <AcceptReplacementDialog
          section={saved}
          onClose={() => setDialog(null)}
          onAccept={() =>
            decideInDialog(async () => {
              const after = await decideReplacement(
                reference,
                sectionId,
                saved.replacement!.draft.id,
                'accept',
              )
              setView('saved')
              return after
            })
          }
        />
      )}
    </div>
  )
}
