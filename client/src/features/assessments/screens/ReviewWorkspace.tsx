import { lazy, Suspense, useState } from 'react'
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
import { AppendixPhotos } from '../components/AppendixPhotos'
import { ChartBoundary } from '../components/ChartBoundary'
import { DraftEditor, type FindingActions } from '../components/DraftEditor'
import { ExecutiveSummary } from '../components/ExecutiveSummary'
import { LossEstimateFigures } from '../components/LossEstimateFigures'
import { RiskQualityFigures } from '../components/RiskQualityFigures'
import { PurposeScope } from '../components/PurposeScope'
import { ReportPart } from '../components/ReportPart'
import { RiskMatrix } from '../components/RiskMatrix'
import { OfiReviewPanel } from '../components/OfiReviewPanel'
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
import { WrittenBlocks } from '../components/WrittenBlocks'
import { contentCitationNumbers, hasWritten, partContent, sectionContent } from '../documentContent'
import { describeCitation, type Claim, type ReviewFocus } from '../reviewDisplay'
import { formatDayTime } from '../format'
import { useObservations } from '../useObservations'
import { useOfis } from '../useOfis'
import { useReview } from '../useReview'
import { useSummary } from '../useSummary'
import '../review.css'
// Loaded on first open: the document editor brings TipTap, which the rest of
// the workspace can skip.
const DocumentEdit = lazy(() => import('./DocumentEdit').then((m) => ({ default: m.DocumentEdit })))

// Section 3's charts (GN-12) load on first view: they bring the chart library.
const OfiCharts = lazy(() =>
  import('../components/OfiCharts').then((m) => ({ default: m.OfiCharts })),
)

const NOTHING: ReviewFocus = { citation: null, statement: null }
// The rail's rows that are not one of sections 4-12.
const OPENING = new Set(['1', '2', '3', 'A'])

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
    // The saved draft's document edits name its findings, not these.
    document: null,
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
// Sections 1 and 2 lead the rail and Appendix A ends it (GN-07).
// Edit document opens the whole report as one document to write in (RV-08);
// Return to review comes back on the section being edited, with its changes.
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
  // Also who may change Appendix A (GN-07); the gateway checks both too.
  canReview?: boolean
  wrapStyle: React.CSSProperties
  railStyle: React.CSSProperties
  panelStyle: React.CSSProperties
  onGenerate: () => void
}) {
  const { workspace, loadError, keep, reload } = useReview(reference)
  const { ofis, setOfis } = useOfis(reference)
  const { summary, loadError: summaryError, reload: reloadSummary } = useSummary(reference)
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
  // The document edit view (RV-08), open on a section; and, once reopened
  // after a refused save, the workspace read it waits to replace.
  const [documentAt, setDocumentAt] = useState<string | null>(null)
  const [reopening, setReopening] = useState<string | null>(null)
  const [documentKey, setDocumentKey] = useState(0)
  // Back from the document: the workspace read before it, until the reload
  // lands with the saved changes (AC2).
  const [returnedFrom, setReturnedFrom] = useState<string | null>(null)

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

  if (documentAt) {
    // Reopened after a refused save: the document waits for the new read.
    if (reopening !== null && workspace.asOf !== reopening) {
      setReopening(null)
      setDocumentKey((k) => k + 1)
    }
    if (reopening !== null)
      return loadError ? (
        <div style={{ padding: '24px 28px' }}>
          <Callout tone="danger" title="The document could not be reloaded">
            {loadError}
          </Callout>
        </div>
      ) : (
        <p style={{ padding: '24px 28px', margin: 0 }}>Reloading the document…</p>
      )
    return (
      <Suspense fallback={<p style={{ padding: '24px 28px', margin: 0 }}>Opening the document…</p>}>
        <DocumentEdit
          key={documentKey}
          reference={reference}
          workspace={workspace}
          summary={summary}
          summaryLoaded={!!summary || !!summaryError}
          ofis={accepted}
          startAt={documentAt}
          onReturn={(id) => {
            setReturnedFrom(workspace.asOf)
            setDocumentAt(null)
            setSelected(id)
            setFocus(NOTHING)
            setView('saved')
            setProblem(null)
            reload()
            void reloadSummary()
          }}
          onReload={() => {
            setReopening(workspace.asOf)
            reload()
            void reloadSummary()
          }}
          wrapStyle={wrapStyle}
          railStyle={railStyle}
        />
      </Suspense>
    )
  }

  const drafted = sections.filter((s) => s.draft)
  // The first drafted section opens until another is chosen.
  const index = Math.max(
    0,
    sections.findIndex((s) => s.id === (selected ?? drafted[0]?.id)),
  )
  // undefined only when the template lists no sections (S4 not answering).
  const saved = sections[index] as (typeof sections)[number] | undefined
  const showing = view === 'replacement' && saved?.replacement ? 'replacement' : 'saved'
  const section = saved && (showing === 'replacement' ? replacementView(saved) : saved)
  // Numbered in the order the section's text cites them, as edited (RV-08).
  const numbers = section?.draft
    ? contentCitationNumbers(sectionContent(section))
    : new Map<string, number>()
  const describe = (citation: string) => describeCitation(section!, citation)
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
      selected={selected && OPENING.has(selected) ? selected : (saved?.id ?? '')}
      onSelect={select}
      inReport={accepted.length}
      executiveSummary={summary?.executiveSummary ?? null}
      onEditDocument={canReview ? () => setDocumentAt(selected ?? saved?.id ?? '1') : undefined}
      editPending={returnedFrom !== null && workspace.asOf === returnedFrom && !loadError}
      style={railStyle}
    />
  )
  const last = sections[sections.length - 1]
  // Every part of the report in order, for "Draft editor · N of M": Sections 1, 2 and 3,
  // the drafted sections (4-12), then Appendix A.
  const parts = ['1', '2', '3', ...sections.map((s) => s.id), 'A']
  const positionOf = (id: string) => `${parts.indexOf(id) + 1} of ${parts.length}`

  // What the engineer wrote into Section 1 or 3 or Appendix A in the
  // document editor (RV-08), after the part's own content.
  const writtenIn = (id: '1' | '3' | 'A') => {
    const version = workspace.parts?.[id] ?? null
    const blocks = partContent(version).intro
    return (
      version &&
      hasWritten(blocks) && (
        <div className="rv-written-section" aria-label="Written by you" role="group">
          <p className="rv-label">Written by you</p>
          <WrittenBlocks blocks={blocks} />
          <p className="rv-provenance" style={{ margin: 0 }}>
            Last saved in the document {formatDayTime(new Date(version.savedAt))} by{' '}
            {version.savedBy.name}
          </p>
        </div>
      )
    )
  }

  // Sections 1 and 2, and Appendix A: one view each, with a side panel that
  // says where its content comes from.
  const part = (
    id: string,
    title: string,
    body: React.ReactNode,
    note: string,
    nav: { onPrevious?: () => void; onNext?: () => void },
  ) => (
    <div style={wrapStyle}>
      {rail}
      <ReportPart title={title} position={positionOf(id)} {...nav}>
        {body}
        {(id === '1' || id === 'A') && writtenIn(id)}
      </ReportPart>
      <aside aria-label={`${title} notes`} className="om-scroll" style={panelStyle}>
        <div className="rv-panel-section">
          <div className="rv-viewer is-empty">
            <p className="rv-muted">{note}</p>
          </div>
        </div>
      </aside>
    </div>
  )
  if (selected === '1')
    return part(
      '1',
      '1. Purpose and Scope',
      <PurposeScope text={summary?.purposeAndScope ?? null} error={summaryError} />,
      'Section 1 is filled in from the assessment and site details, with no AI drafting. It always matches them.',
      { onNext: () => select('2') },
    )
  if (selected === '2')
    return part(
      '2',
      '2. Executive Summary',
      <ExecutiveSummary
        summary={summary?.executiveSummary ?? null}
        error={summaryError}
        onGenerate={onGenerate}
        document={workspace.parts?.['2'] ?? null}
      />,
      'The Executive Summary is drafted only from Sections 3 to 12 as they stand. Each statement names the sections it rests on.',
      { onPrevious: () => select('1'), onNext: () => select('3') },
    )
  if (selected === 'A')
    return part(
      'A',
      'Appendix A. Site Photos',
      <AppendixPhotos reference={reference} canEdit={canReview} />,
      'The export (EX-01) shows only these photos, in this order, with their captions.',
      { onPrevious: last && (() => select(last.id)) },
    )

  // Nothing drafted yet: the rail stays, so Sections 1 and 2 and Appendix A
  // (which need no draft of 7-12) can still be opened (GN-07 AC1, AC5).
  if (!saved || !section || (!drafted.length && selected !== '3'))
    return (
      <div style={wrapStyle}>
        {rail}
        <section className="om-scroll rv-editor">
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
        </section>
      </div>
    )

  // Section 3, laid out like a section's draft: the editor bar, the provenance of
  // the OFIs' drafting, then the suggestions to accept and the OFIs in the report,
  // each in an AI draft box. Accepting happens here, not on Generation (GN-07).
  if (selected === '3') {
    const drafted = (accepted[0] ?? ofis?.suggestions?.[0])?.provenance
    return (
      <div style={wrapStyle}>
        {rail}
        <section aria-label="Draft editor" className="om-scroll rv-editor">
          <div className="rv-editor-inner">
            <div className="rv-editor-bar">
              <p className="rv-label">Draft editor · {positionOf('3')}</p>
              <Button variant="ghost" size="sm" iconLeft="chevron-left" onClick={() => select('2')}>
                Previous
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconRight="chevron-right"
                disabled={!sections.length}
                onClick={() => select(sections[0].id)}
              >
                Next
              </Button>
            </div>
            <h2>3. Opportunities for Improvement</h2>
            {/* Marsh's matrix opens the section, drafted or not (GN-12 AC6). */}
            <RiskMatrix />
            {!drafted ? (
              <EmptyState
                icon="file-text"
                title="No OFIs in the report yet"
                description="Draft Opportunities for Improvement on the Generation tab, then accept them here."
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
                <OfiReviewPanel
                  reference={reference}
                  ofis={{ suggestions: ofis?.suggestions ?? [], accepted }}
                  setOfis={setOfis}
                  observations={observations ?? []}
                  canAccept={canReview}
                  onAccepted={() => void reloadSummary()}
                />
                {/* Drawn from the accepted OFIs above, so accepting one redraws them. */}
                <ChartBoundary>
                  <OfiCharts accepted={accepted} />
                </ChartBoundary>
              </>
            )}
            {writtenIn('3')}
          </div>
        </section>
        <aside aria-label="Section 3 suggestions" className="om-scroll" style={panelStyle}>
          <div className="rv-panel-section">
            <div className="rv-viewer is-empty">
              <p className="rv-muted">
                {waiting
                  ? `${waiting} suggested OFI${waiting === 1 ? ' is' : 's are'} waiting to be accepted.`
                  : 'No suggested OFIs are waiting.'}{' '}
                Each OFI's sources open below it. Suggestions are drafted on Generation and accepted
                here.
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
        position={positionOf(saved.id)}
        onPrevious={() => select(previous ? previous.id : '3')}
        // The last section leads on to Appendix A.
        onNext={() => select(next ? next.id : 'A')}
        onGenerate={onGenerate}
        numbers={numbers}
        focus={focus}
        describe={describe}
        onCite={cite}
        actions={actions}
        // Sections 4 and 5's figures (GN-03); saving them reloads the workspace, so
        // the draft shows as out of date when they changed.
        figures={
          saved.id === '4' ? (
            <RiskQualityFigures reference={reference} canEdit={canReview} onSaved={reload} />
          ) : saved.id === '5' ? (
            // Section 5 places its drafted findings in each level's table itself.
            (drafted: Map<string, React.ReactNode>) => (
              <LossEstimateFigures
                reference={reference}
                canEdit={canReview}
                onSaved={reload}
                drafted={drafted}
              />
            )
          ) : undefined
        }
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
