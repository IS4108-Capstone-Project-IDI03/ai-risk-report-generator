// F-12: the records of one practice assessment, written from the template (ADR 0003): its
// client and site, checklist, observations, site walk, OFIs, proposed figures, drafted sections
// and review log entries. Called by practice.service.ts. Calls the models and drafting's
// evidence reader (section.service.ts); never AI, never a notification.
import { Types } from 'mongoose'
import { AssessmentModel } from '../../models/assessment.model'
import { CaptureSessionModel } from '../../models/capture-session.model'
import { ChecklistModel } from '../../models/checklist.model'
import { ClientModel } from '../../models/client.model'
import { ObservationModel } from '../../models/observation.model'
import { ReportOfiModel } from '../../models/report-ofi.model'
import { ReportSectionModel } from '../../models/report-section.model'
import { ReviewAuditModel } from '../../models/review-audit.model'
import { SiteModel } from '../../models/site.model'
import { SiteWalkModel } from '../../models/site-walk.model'
import type { SessionUser } from '../auth.service'
import { draftingEvidence } from '../section.service'
import * as T from './template'
import { SECTIONS } from './template-sections'

export type Ids = { assessment: Types.ObjectId; site: Types.ObjectId; client: Types.ObjectId }

/** Writes the records under a new practice assessment (steps b. to g.); returns nothing. */
export async function fillPractice(
  user: SessionUser,
  reference: string,
  ids: Ids,
  location: Record<string, Types.ObjectId>,
  now: Date,
) {
  // The metadata every record must carry (CLAUDE.md), from the made-up site.
  const metadata = <S extends string, C = 'all'>(source_type: S, COPE_dimension = 'all' as C) => ({
    source_type,
    jurisdiction: T.SITE.jurisdiction,
    facility_type: T.SITE.facilityType,
    COPE_dimension,
    effective_date: now,
  })
  const by = { id: user.id, name: user.name }
  const createdBy = new Types.ObjectId(user.id)

  // b. Its own made-up client and site; keys unique to this user and reference, so a reset's
  // fresh pair never clashes with the hidden old one.
  await ClientModel.create({
    _id: ids.client,
    name: T.CLIENT_NAME,
    key: `practice:${user.id}:${reference}`,
    practice: true,
  })
  await SiteModel.create({
    _id: ids.site,
    code: reference,
    name: T.SITE.name,
    address: T.SITE.address,
    jurisdiction: T.SITE.jurisdiction,
    facilityType: T.SITE.facilityType,
    client: ids.client,
    practice: true,
  })

  // c. The checklist; items answered by an observation carry no mark of their own, and one
  // item is left unanswered (template.ts).
  const item = Object.fromEntries(T.CHECKLIST.map((i) => [i.ref, new Types.ObjectId()]))
  const checklist = await ChecklistModel.create({
    assessment: ids.assessment,
    facilityType: T.SITE.facilityType,
    jurisdiction: T.SITE.jurisdiction,
    areas: T.CHECKLIST_AREAS,
    items: T.CHECKLIST.map((i) => ({
      _id: item[i.ref],
      area: i.area,
      subsection: i.text,
      origin: 'template' as const,
      text: i.text,
      check: i.mark ? { mark: i.mark, at: now, by } : null,
    })),
    provenance: {
      ...T.PREPARED,
      checklist_version: 'practice',
      template_version: 'global-pre-v2.0-2026-02',
      generated_at: now,
    },
    createdBy,
    metadata: metadata('checklist'),
  })

  // d. The observations, in a capture session still open so New Observation works. The
  // amber one's suggestion is finished ('done'), so no reading job ever picks it up.
  const session = await CaptureSessionModel.create({ assessment: ids.assessment })
  const observation = Object.fromEntries(T.OBSERVATIONS.map((o) => [o.ref, new Types.ObjectId()]))
  await ObservationModel.create(
    T.OBSERVATIONS.map((o) => ({
      _id: observation[o.ref],
      assessment: ids.assessment,
      session: session._id,
      engineer: user.name,
      engineerId: createdBy,
      // One note carries a question for the client: the same two parts Split note would save,
      // so "To ask the client" has a row and drafting reads the fact alone.
      note: o.ask ? `${o.note}\nIR ${o.ask}` : o.note,
      ...(o.ask && {
        parts: [
          { id: 'p1', kind: 'fact' as const, text: o.note, shorthand: o.note, inferred: true },
          {
            id: 'p2',
            kind: 'info_request' as const,
            text: o.ask,
            shorthand: `IR ${o.ask}`,
            inferred: false,
          },
        ],
      }),
      recordings: [],
      photos: [],
      pages: [],
      severity: o.severity,
      location: location[o.location],
      checklistItem: {
        checklist: checklist._id,
        item: item[o.answers.item],
        result: o.answers.result,
        text: T.CHECKLIST.find((i) => i.ref === o.answers.item)!.text,
      },
      ...(o.toCheck && {
        suggestion: {
          status: 'done' as const,
          attempts: 1,
          category: { notSure: true },
          severity: { notSure: true },
          run: 1,
        },
      }),
      metadata: metadata('observation', o.cope),
    })),
  )
  const cite = (refs: string[]) => refs.map((r) => `O:${observation[r]}`)

  // e. The site walk ready to review; `notified` so no "walk ready" notice is ever sent.
  const proposed = (l: string) => (l === 'new' ? 'L2' : 'L1')
  await SiteWalkModel.create({
    assessment: ids.assessment,
    engineerId: createdBy,
    status: 'ready' as const,
    name: T.WALK.name,
    typedText: T.WALK.typedText,
    notified: true,
    proposal: {
      locations: [
        { ref: 'L1', existingId: String(location.bay), kind: 'building', ...block('bay') },
        {
          ref: 'L2',
          existingId: null,
          kind: 'elsewhere',
          building: null,
          floor: null,
          name: T.WALK.newLocation,
        },
      ],
      observations: T.WALK.observations.map((o, n) => ({
        ref: `O${n + 1}`,
        note: o.note,
        copeDimension: o.copeDimension,
        severity: o.severity,
        locationRef: proposed(o.location),
        recordingSeq: null,
        start: null,
        end: null,
        photoIds: [],
        mediaIds: [],
        check: { severity: o.unsure, category: false, location: false },
      })),
    },
    metadata: metadata('site_walk', null),
  })

  // f. Section 3's suggested OFIs and Sections 4 and 5's proposed figures, no scores entered.
  const ofiProvenance = {
    ...T.PREPARED,
    config_version: 'ofi-config-2026-10-08',
    generated_at: now,
  }
  await ReportOfiModel.create(
    T.OFIS.map(({ observation: ref, finding, ...ofi }) => ({
      ...ofi,
      assessment: ids.assessment,
      state: 'suggested' as const,
      observation: finding,
      observations: [String(observation[ref])],
      provenance: ofiProvenance,
      createdBy,
      metadata: metadata('ofi'),
    })),
  )
  const proposal = {
    provenance: { ...T.PREPARED, generated_at: now },
    proposedAt: now,
    proposedBy: user.id,
  }
  const reason = T.SCORE_REASON
  await AssessmentModel.updateOne(
    { _id: ids.assessment },
    {
      $set: {
        'riskQuality.proposal': {
          categories: T.SCORES.map(({ cite: refs, ...s }) => ({
            ...s,
            reason,
            citations: cite(refs),
          })),
          ...proposal,
        },
        'lossEstimates.proposal': {
          levels: T.LEVELS.map((l) => ({
            level: l.level,
            damage: [
              { item: 'Buildings', percent: l.buildings, reason, citations: cite(l.cite) },
              { item: 'Stock', percent: l.stock, reason, citations: cite(l.cite) },
            ],
            te: [
              {
                item: 'Business Interruption',
                months: l.months,
                percent: l.percent,
                reason,
                citations: cite(l.cite),
              },
            ],
          })),
          ...proposal,
        },
      },
    },
  )

  // g. Generation's step 1: Sections 6-12 drafted from prepared text, each given the evidence
  // drafting would give it now, so none reads out of date. Sections 4, 5 and 2 are step 3, left
  // until the engineer's figures and an accepted OFI are in. Then the accepted findings in the
  // review log, written last: it is append-only, so a failure after it would leave entries
  // behind for drafts removeMade deletes. Acceptable: they name a draft nothing reads.
  const evidence = await draftingEvidence(reference)
  const provenance = {
    ...T.PREPARED,
    template_version: 'global-pre-v2.0-2026-02',
    generated_at: now,
  }
  const drafts = await ReportSectionModel.create(
    SECTIONS.map((s) => ({
      assessment: ids.assessment,
      sectionId: s.id,
      title: s.title,
      subsections: s.subsections.map(({ heading, statements }) => ({
        heading,
        kind: 'narrative' as const,
        statements: statements.map((st) => ({
          text: st.text,
          citations: cite(st.cite),
          supported: !st.unsupported,
        })),
      })),
      sources: {},
      questions: [],
      evidence,
      guardrail: { passed: !unsupportedIn(s), unsupported_count: unsupportedIn(s) },
      provenance,
      createdBy,
      metadata: metadata('report_section', s.cope),
    })),
  )
  await ReviewAuditModel.create(
    SECTIONS.flatMap((s, n) =>
      s.accepted.map((key) => {
        const [i, j] = key.split('.').map(Number)
        const saved = drafts[n].subsections[i]
        return {
          assessment: ids.assessment,
          sectionId: s.id,
          draft: drafts[n]._id,
          finding: key,
          sequence: 0,
          action: 'accept' as const,
          heading: saved.heading,
          before: saved.statements[j].text,
          after: null,
          citations: saved.statements[j].citations,
          instruction: null,
          bulk: false,
          by,
          at: now,
          metadata: metadata('review_decision', s.cope),
        }
      }),
    ),
  )
}

// How many of a template section's findings have no evidence.
const unsupportedIn = (s: (typeof SECTIONS)[number]) =>
  s.subsections.flatMap((x) => x.statements).filter((st) => st.unsupported).length

// A template location's building, floor and name, as a proposal's location carries them.
function block(ref: string) {
  const { building, floor, name } = T.LOCATIONS.find((l) => l.ref === ref)!
  return { building, floor, name }
}

/** Deletes what one failed make created (never a review log entry: those are never deleted); returns nothing. */
export async function removeMade(ids: Ids) {
  const under = { assessment: ids.assessment }
  await Promise.all([
    CaptureSessionModel.deleteMany(under),
    ChecklistModel.deleteMany(under),
    ObservationModel.deleteMany(under),
    SiteWalkModel.deleteMany(under),
    ReportOfiModel.deleteMany(under),
    ReportSectionModel.deleteMany(under),
    ClientModel.deleteOne({ _id: ids.client }),
    SiteModel.deleteOne({ _id: ids.site }),
    AssessmentModel.deleteOne({ _id: ids.assessment }),
  ])
}
