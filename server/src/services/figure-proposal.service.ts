// Proposed figures for Sections 4 and 5 (GN-03 addendum, AC12-AC15): asks S4 to propose
// Section 4's scores or Section 5's per-level % and months from the observations and the
// drafted sections, and stores the proposal beside the figures. The rating and losses
// are never computed from it (AC10). Called by routes/assessment.routes.ts. Calls
// rag.service.ts, then the figure services for the response.
import type { IAssessment } from '../models/assessment.model'
import { AssessmentModel } from '../models/assessment.model'
import type { SessionUser } from './auth.service'
import { recordAiCalls } from './ai-usage.service'
import { getLossEstimates, levelFiguresEntered, lossEstimatesOf } from './loss-estimate.service'
import { requestFigureProposal, type ProposedLevel } from './rag.service'
import { getRiskQuality, pendingProposal, scoresEntered } from './risk-quality.service'
import { assessmentToDraft, draftingEvidence, InsufficientEvidenceError } from './section.service'
import { currentSections } from './summary.service'

// The sections a proposal reads beside the observations: the drafted 6-12 say what the
// site has, and Section 3's accepted OFIs what it lacks, which the potential scores need.
const READ = ['3', '6', '7', '8', '9', '10', '11', '12']

export class FiguresEnteredError extends Error {
  constructor(section: '4' | '5', waiting: boolean) {
    super(
      waiting
        ? 'Figures are already proposed: check and confirm them in Review.'
        : section === '4'
          ? 'Scores are already entered: edit them directly.'
          : 'Level figures are already entered: edit them directly.',
    )
    this.name = 'FiguresEnteredError'
  }
}

// Months beyond the indemnity period can't be entered (lossEstimatesSchema), so a
// proposal of them is left blank too (AC15). S4 checks the other ranges.
function withinIndemnity(levels: ProposedLevel[], indemnityMonths: number | null) {
  return levels.map((l) => ({
    ...l,
    te: l.te.map((t) =>
      indemnityMonths !== null && t.months !== null && t.months > indemnityMonths
        ? { ...t, months: null }
        : t,
    ),
  }))
}

export async function proposeFigures(reference: string, section: '4' | '5', user: SessionUser) {
  // 1. Only the assigned engineer, before any figure is entered (AC14), and not while a
  // proposal waits to be confirmed: a second one would be another paid call.
  const assessment = await assessmentToDraft(reference, user)
  const loss = lossEstimatesOf(assessment.lossEstimates)
  const saved = section === '4' ? assessment.riskQuality : assessment.lossEstimates
  const entered =
    section === '4' ? scoresEntered(assessment.riskQuality) : levelFiguresEntered(loss.inputs)
  const waiting = pendingProposal(saved) !== null
  if (entered || waiting) throw new FiguresEnteredError(section, waiting)

  // 2. The evidence: observations, and the text of the sections drafted so far.
  const observations = await draftingEvidence(reference)
  if (!observations.length) throw new InsufficientEvidenceError(0, 1)
  const sections = (await currentSections(assessment)).filter((s) => READ.includes(s.id) && s.text)

  // 3. S4 proposes; the call is billed even if saving fails, so record it first.
  const site = assessment.site!
  const answer = await requestFigureProposal({
    section_id: section,
    assessment: { reference, jurisdiction: site.jurisdiction, facility_type: site.facilityType },
    observations,
    sections: sections.map(({ id, title, text }) => ({ id, title, text })),
    ...(section === '5' && { te_items: loss.inputs.te.map((t) => t.item) }),
  })
  await recordAiCalls(answer.usage, { reportId: reference, section })

  // 4. Stored beside the figures, with who asked and the model's provenance.
  const figures =
    section === '4'
      ? { categories: answer.proposal.categories ?? [] }
      : { levels: withinIndemnity(answer.proposal.levels ?? [], loss.inputs.indemnityMonths) }
  const proposal = {
    ...figures,
    provenance: answer.provenance,
    proposedAt: new Date(),
    proposedBy: user.id,
  }
  const field: keyof IAssessment = section === '4' ? 'riskQuality' : 'lossEstimates'
  await AssessmentModel.updateOne(
    { _id: assessment._id },
    { $set: { [`${field}.proposal`]: proposal } },
  )
  return section === '4' ? getRiskQuality(reference) : getLossEstimates(reference)
}
