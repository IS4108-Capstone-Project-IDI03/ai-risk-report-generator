// `npm run seed`: one demo seed that fills an empty app with a few realistic Singapore cases,
// one per stage, so every main screen has something to show. Run by hand, never by the app.
//   npm run seed             adds or refreshes the demo set (upsert by fixed keys; safe to repeat)
//   npm run seed -- --reset  first empties everything except the knowledge base and admin settings
// The knowledge base (knowledge documents, ingestion jobs, manual standards, knowledge requests)
// and the vector store are never touched: knowledge search needs documents really ingested.
// No AI call and no file upload. Content is in seed-demo-data.ts, usage and notifications in
// seed-demo-usage.ts. The older per-story seeds (seed:cp23, seed:comparison ...) still work.
import 'dotenv/config'
import bcrypt from 'bcrypt'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import mongoose, { Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ClientModel } from '../models/client.model'
import { CounterModel } from '../models/counter.model'
import { connectDb } from '../models/db'
import { ObservationModel, type CopeDimension } from '../models/observation.model'
import { ReportCommentThreadModel } from '../models/report-comment.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { ReportSectionModel } from '../models/report-section.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { SiteModel } from '../models/site.model'
import { UserModel } from '../models/user.model'
import { UserSettingsModel } from '../models/user-settings.model'
import { advanceStage } from '../services/assistant/stage'
import type { Stage } from '../services/assistant/types'
import { clientKey } from '../services/client.service'
import { locationKey } from '../services/location.service'
import { RQR_CATEGORIES } from '../services/risk-quality.service'
import { currentSections } from '../services/summary.service'
import { draftingEvidence, figureFacts } from '../services/section.service'
import { currentDocument, sectionText } from '../services/section-document'
import {
  CLIENTS,
  JURONG_COMMENT,
  JURONG_DECISIONS,
  JURONG_FINDINGS,
  JURONG_OFIS,
  JURONG_PLACES,
  JURONG_SEEN,
  KESTREL_CURRENT_SEEN,
  KESTREL_FINDINGS,
  KESTREL_OFIS,
  KESTREL_PLACES,
  KESTREL_PREVIOUS_SEEN,
  MARINA_SUMMARY,
  PANDAN_PLACES,
  PANDAN_SEEN,
  SEED_PASSWORD,
  SITES,
  TEMPLATE,
  TEMPLATE_VERSION,
  USERS,
  type Findings,
  type Place,
  type Seen,
} from './seed-demo-data'
import { seedNotifications, seedUsage } from './seed-demo-usage'

const RESET = process.argv.includes('--reset')

// What --reset keeps: the knowledge base, and the admin's settings and word lists.
const KEEP_COLLECTIONS = new Set([
  'knowledge_documents',
  'ingestion_jobs',
  'manual_sections',
  'knowledge_gap_requests',
  'app_settings',
  'settings_log',
  'privacy_words',
  'checklistfixeditems',
  'checklist_fixed_items',
])
// Notifications about the knowledge base stay too, so its Inbox items are not orphaned.
const KEEP_NOTIFICATIONS = [
  'knowledge_gap_request',
  'ingestion_status',
  'knowledge_document_status',
]

const day = (offset: number) => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + offset)
  return d
}
const PROVENANCE = {
  provider: 'seed',
  model: 'seed-fixture',
  effort: 'none',
  prompt_version: 'seed',
}
// From ofi.json's Risk Assessment Matrix: the priority a likelihood and consequence give.
const RAM: Record<string, Record<string, string>> = {
  'Almost Certain': {
    Insignificant: 'Priority 2',
    Minor: 'Priority 2',
    Moderate: 'Priority 1',
    Major: 'Priority 1',
    Catastrophic: 'Priority 1',
  },
  Likely: {
    Insignificant: 'Priority 3',
    Minor: 'Priority 2',
    Moderate: 'Priority 2',
    Major: 'Priority 1',
    Catastrophic: 'Priority 1',
  },
  Possible: {
    Insignificant: 'Priority 4',
    Minor: 'Priority 3',
    Moderate: 'Priority 2',
    Major: 'Priority 1',
    Catastrophic: 'Priority 1',
  },
  Unlikely: {
    Insignificant: 'Priority 4',
    Minor: 'Priority 4',
    Moderate: 'Priority 3',
    Major: 'Priority 2',
    Catastrophic: 'Priority 1',
  },
  'Very Rare': {
    Insignificant: 'Priority 4',
    Minor: 'Priority 4',
    Moderate: 'Priority 3',
    Major: 'Priority 2',
    Catastrophic: 'Priority 2',
  },
}

type Id = Types.ObjectId

// ---- Reset ----------------------------------------------------------------

// Empties every collection except the kept ones, through the driver so the append-only
// models (review log, versions) do not refuse. The demo accounts keep their ids.
async function wipe() {
  const db = mongoose.connection.db!
  for (const { name } of await db.listCollections({}, { nameOnly: true }).toArray()) {
    if (KEEP_COLLECTIONS.has(name) || name.startsWith('system.')) continue
    const filter =
      name === 'notifications'
        ? { purpose: { $nin: KEEP_NOTIFICATIONS } }
        : name === 'users'
          ? { email: { $nin: USERS.map((u) => u.email) } }
          : {}
    const { deletedCount } = await db.collection(name).deleteMany(filter)
    if (deletedCount) console.log(`  cleared ${deletedCount} from ${name}`)
  }
}

// ---- Accounts, clients, sites ---------------------------------------------

// Creates the demo accounts if missing (a reset also sets their password again), and marks
// Alex's and Sana's walkthroughs done. Returns each account's id by email.
async function seedUsers(): Promise<Record<string, Id>> {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10)
  const ids: Record<string, Id> = {}
  for (const { walkthroughsSeen, ...profile } of USERS) {
    const user = await UserModel.findOneAndUpdate(
      { email: profile.email },
      RESET
        ? { $setOnInsert: { ...profile, active: true }, $set: { passwordHash } }
        : { $setOnInsert: { ...profile, active: true, passwordHash } },
      { upsert: true, returnDocument: 'after' },
    )
    ids[profile.email] = user._id
    if (!walkthroughsSeen) continue
    const now = new Date()
    await UserSettingsModel.updateOne(
      { user: String(user._id) },
      {
        $set: {
          'walkthroughs.welcomeAt': now,
          'walkthroughs.offers': false,
          'walkthroughs.seen.welcome': { state: 'played', at: now },
        },
        $setOnInsert: {
          user: String(user._id),
          metadata: {
            source_type: 'settings',
            jurisdiction: null,
            facility_type: null,
            COPE_dimension: null,
            effective_date: now,
          },
        },
      },
      { upsert: true },
    )
  }
  return ids
}

// Creates the clients and sites; returns each site's id and its jurisdiction by code.
async function seedSites() {
  const clients: Id[] = []
  for (const c of CLIENTS) {
    const saved = await ClientModel.findOneAndUpdate(
      { key: clientKey(c.name) },
      { $set: { name: c.name, ...(c.division && { division: c.division }) } },
      { upsert: true, returnDocument: 'after' },
    )
    clients.push(saved._id)
  }
  const sites: Record<string, { _id: Id; name: string; facilityType: string }> = {}
  for (const { client, ...s } of SITES) {
    const saved = await SiteModel.findOneAndUpdate(
      { code: s.code },
      { $set: { ...s, jurisdiction: 'SG', client: clients[client] } },
      { upsert: true, returnDocument: 'after' },
    )
    sites[s.code] = saved
  }
  return sites
}

// ---- One assessment -------------------------------------------------------

type Case = {
  ref: string
  site: string
  type: 'First survey' | 'Resurvey'
  visit: number
  visitEnd?: number
  due?: number
  engineer: string
  stage: Stage
  status?: 'draft' | 'under_review' | 'finalised'
  contacts?: { name: string; role: string }[]
  places?: Record<string, Place>
  seen?: Seen[]
  // Whether the capture session is still open (on site) or done.
  capture?: 'active' | 'done'
}

type Built = {
  _id: Id
  reference: string
  idOf: Map<string, string>
  site: { _id: Id; facilityType: string }
  engineer: { _id: Id; name: string }
  when: Date
}

// Removes what an earlier run of the seed put under this assessment, and refuses when the
// reference belongs to other data: without this, a repeat run could overwrite a real report.
async function claim(ref: string, siteCode: string) {
  const old = await AssessmentModel.findOne({ reference: ref }, 'site').lean()
  if (!old) return
  const site = await SiteModel.findById(old.site, 'code').lean()
  if (site?.code !== siteCode)
    throw new Error(`${ref} already belongs to other data. Run \`npm run seed -- --reset\` first.`)
  const where = { assessment: old._id }
  await Promise.all([
    ObservationModel.deleteMany(where),
    CaptureSessionModel.deleteMany(where),
    ReportSectionModel.deleteMany(where),
    ReportOfiModel.deleteMany(where),
    ReportCommentThreadModel.deleteMany(where),
    // Append-only through their models, so through the driver, as the other seeds do.
    ReviewAuditModel.collection.deleteMany(where),
    mongoose.connection.db!.collection('report_section_versions').deleteMany(where),
  ])
}

// Saves the assessment with its places, session and observations. Returns what the report
// builders need: the observation ids by the fixture's own ids, and who and when.
async function buildCase(
  c: Case,
  sites: Awaited<ReturnType<typeof seedSites>>,
  users: Record<string, Id>,
): Promise<Built> {
  await claim(c.ref, c.site)
  const site = sites[c.site]
  const engineer = USERS.find((u) => u.email === c.engineer)!
  // Each place gets an id; `at` in the fixtures names a place by its key here.
  const places = Object.entries(c.places ?? {}).map(([at, p]) => ({
    at,
    _id: new Types.ObjectId(),
    ...p,
    key: locationKey(p.name, p.floor, p.building),
  }))
  const visited = day(c.visit)
  const fields = {
    site: site._id,
    surveyType: c.type,
    siteVisitDate: visited,
    ...(c.visitEnd !== undefined && { siteVisitEndDate: day(c.visitEnd) }),
    ...(c.due !== undefined && { reportDueDate: day(c.due) }),
    ...(c.contacts && { siteContacts: c.contacts }),
    engineer: users[c.engineer],
    ...(c.status && { reportStatus: c.status }),
    locations: places.map(({ at: _at, ...p }) => p),
    appendixPhotos: [],
  }
  const assessment = await AssessmentModel.findOneAndUpdate(
    { reference: c.ref },
    {
      $set: fields,
      // A repeat run starts the figures, export and status afresh.
      $unset: {
        riskQuality: 1,
        lossEstimates: 1,
        exportedAt: 1,
        exportFile: 1,
        archivedAt: 1,
        ...(!c.status && { reportStatus: 1 }),
      },
    },
    { upsert: true, returnDocument: 'after' },
  ).lean()
  if (!assessment) throw new Error(`${c.ref} was not saved`)
  // MarshBot's stage moves only forward and only through advanceStage; the seed has no running
  // server to re-check it, so it names the stage each fixture's data already proves.
  // Dated as the data was: an exported stage on the export day, "setup" a week before the visit
  // (or now, for a visit still ahead), so the stage dates read in order.
  const stageDay = day(c.visit + (c.stage === 'exported' ? 16 : 0))
  const createdAt = new Date(Math.min(Date.now(), visited.getTime() - 7 * 86_400_000))
  await advanceStage({ ...assessment, createdAt }, c.stage, stageDay)

  const idOf = new Map<string, string>()
  if (c.seen?.length) {
    const session = await CaptureSessionModel.create({
      assessment: assessment._id,
      status: c.capture === 'active' ? 'active' : 'ready_for_generation',
    })
    const saved = await ObservationModel.insertMany(
      c.seen.map((o, i) => ({
        assessment: assessment._id,
        session: session._id,
        engineer: engineer.name,
        engineerId: users[c.engineer],
        note: o.note,
        recordings: [],
        severity: o.severity,
        location: places.find((p) => p.at === o.at)!._id,
        metadata: {
          source_type: 'observation',
          jurisdiction: 'SG',
          facility_type: site.facilityType,
          // Never []: an uncategorised observation stores null (CLAUDE.md hard rules).
          COPE_dimension: o.cope,
          effective_date: visited,
        },
        // A minute apart on the visit day, so they list in the order written.
        createdAt: new Date(visited.getTime() + (9 * 60 + i) * 60_000),
      })),
    )
    c.seen.forEach((o, i) => idOf.set(o.id, String(saved[i]._id)))
  }
  return {
    _id: assessment._id,
    reference: c.ref,
    idOf,
    site,
    engineer: { _id: users[c.engineer], name: engineer.name },
    when: visited,
  }
}

// ---- Drafts, review log, recommendations ----------------------------------

type Sub = {
  heading: string
  kind: 'narrative' | 'fields' | 'table'
  statements: { text: string; cites: string[] }[]
}

// The template's parts for a section with `findings` placed under their headings.
const subsFor = (sectionId: string, findings: Findings): Sub[] =>
  TEMPLATE[sectionId].parts.map((p) => ({
    ...p,
    statements: p.kind === 'table' ? [] : (findings[sectionId]?.[p.heading] ?? []),
  }))

// Saves one section draft whose citations resolve, so none reads as unsupported or out of date.
async function saveDraft(
  b: Built,
  sectionId: string,
  title: string,
  cope: CopeDimension | 'all',
  subs: Sub[],
  evidence: Awaited<ReturnType<typeof draftingEvidence>>,
  facts?: string,
) {
  return ReportSectionModel.create({
    assessment: b._id,
    sectionId,
    title,
    subsections: subs.map((s) => ({
      ...s,
      statements: s.statements.map((st) => ({
        text: st.text,
        citations: st.cites.map((id) => `O:${b.idOf.get(id) ?? id}`),
        supported: true,
      })),
    })),
    sources: {},
    questions: [],
    evidence,
    ...(facts && { facts }),
    guardrail: { passed: true, unsupported_count: 0 },
    provenance: { ...PROVENANCE, template_version: TEMPLATE_VERSION, generated_at: b.when },
    createdBy: b.engineer._id,
    metadata: {
      source_type: 'report_section',
      jurisdiction: 'SG',
      facility_type: b.site.facilityType,
      COPE_dimension: cope,
      effective_date: b.when,
    },
    createdAt: b.when,
  })
}

type Drafted = Awaited<ReturnType<typeof saveDraft>>

// One review log entry (RV-02), as review-decision.service.ts makes them.
function logEntry(
  b: Built,
  d: Drafted,
  key: string,
  action: 'accept' | 'edit' | 'reject',
  at: Date,
  bulk: boolean,
  after?: string,
) {
  const [i, j] = key.split('.').map(Number)
  const st = d.subsections[i].statements[j]
  return {
    assessment: b._id,
    sectionId: d.sectionId,
    draft: d._id,
    finding: key,
    sequence: 0,
    action,
    heading: d.subsections[i].heading,
    before: st.text,
    after: after ?? null,
    citations: st.citations,
    instruction: null,
    bulk,
    by: { id: String(b.engineer._id), name: b.engineer.name },
    at,
    metadata: {
      source_type: 'review_decision' as const,
      jurisdiction: 'SG',
      facility_type: b.site.facilityType,
      COPE_dimension: d.metadata.COPE_dimension,
      effective_date: at,
    },
  }
}

// Accepts every finding of the drafts, as Bulk accept does: a finalised report has none pending.
async function acceptAll(b: Built, drafts: Drafted[]) {
  const at = new Date(b.when.getTime() + 3 * 86_400_000)
  const entries = drafts.flatMap((d) =>
    d.subsections.flatMap((s, i) =>
      s.statements.map((_, j) => logEntry(b, d, `${i}.${j}`, 'accept', at, true)),
    ),
  )
  if (entries.length) await ReviewAuditModel.insertMany(entries)
}

async function saveOfis(
  b: Built,
  ofis: { state?: 'accepted' | 'suggested'; cites: string[]; [k: string]: unknown }[],
) {
  await ReportOfiModel.insertMany(
    ofis.map(({ cites, state = 'accepted', ...o }) => ({
      ...o,
      assessment: b._id,
      state,
      ...(state === 'accepted' && { acceptedAt: b.when, acceptedBy: b.engineer._id }),
      observations: cites.map((id) => b.idOf.get(id)),
      standards: [],
      precedent: null,
      sources: {},
      provenance: { ...PROVENANCE, config_version: 'seed', generated_at: b.when },
      createdBy: b.engineer._id,
      metadata: {
        source_type: 'ofi',
        jurisdiction: 'SG',
        facility_type: b.site.facilityType,
        COPE_dimension: 'all',
        effective_date: b.when,
      },
    })),
  )
}

// Section 4's scores for every category (GN-03).
const scores = (current: number, potential: number) => ({
  categories: RQR_CATEGORIES.map((category) => ({ category, current, potential })),
  updatedAt: new Date(),
})

// ---- The cases ------------------------------------------------------------

// Tuas Cold Store's previous visit: finalised and exported, with drafts for Sections 7-10 and
// two accepted recommendations. It is what RPT-2026-0005's Comparison tab compares with.
async function previousKestrel(b: Built) {
  const evidence = await draftingEvidence(b.reference)
  const drafts: Drafted[] = []
  for (const id of Object.keys(TEMPLATE))
    drafts.push(
      await saveDraft(
        b,
        id,
        TEMPLATE[id].title,
        TEMPLATE[id].cope,
        subsFor(id, KESTREL_FINDINGS),
        evidence,
      ),
    )
  await saveOfis(b, KESTREL_OFIS)
  await acceptAll(b, drafts)
  await AssessmentModel.updateOne(
    { _id: b._id },
    { $set: { riskQuality: { ...scores(7.4, 9), updatedBy: b.engineer._id }, ...exported(b, 14) } },
  )
}

// The export fields of a finalised report, `after` days after the visit.
function exported(b: Built, after: number) {
  const at = new Date(b.when.getTime() + after * 86_400_000)
  return {
    exportedAt: at,
    exportFile: { fileName: `${b.reference} ${at.toISOString().slice(0, 10)}.pdf`, pages: 28 },
  }
}

// Jurong Island Plant: drafts for Sections 7-10, some findings decided, an open comment, and a
// suggested and an accepted recommendation.
async function reviewJurong(b: Built, users: Record<string, Id>) {
  const evidence = await draftingEvidence(b.reference)
  const drafts: Record<string, Drafted> = {}
  for (const id of Object.keys(TEMPLATE))
    drafts[id] = await saveDraft(
      b,
      id,
      TEMPLATE[id].title,
      TEMPLATE[id].cope,
      subsFor(id, JURONG_FINDINGS),
      evidence,
    )
  await saveOfis(b, JURONG_OFIS)

  // "<section>|<heading>|<n>" is the nth finding under that heading; its key is "<part>.<n>".
  const keyOf = (at: string) => {
    const [section, heading, n] = at.split('|')
    return {
      section,
      key: `${TEMPLATE[section].parts.findIndex((p) => p.heading === heading)}.${n}`,
    }
  }
  const decided = new Map<string, { action: string; after?: string }>()
  const at = new Date(b.when.getTime() + 2 * 86_400_000)
  const entries = JURONG_DECISIONS.map((d) => {
    const { section, key } = keyOf(d.at)
    decided.set(`${section}|${key}`, d)
    return logEntry(b, drafts[section], key, d.action, at, false, d.after)
  })
  await ReviewAuditModel.insertMany(entries)

  // The comment's anchor is where its words stand in the section's text now (RV-03).
  const { section, key } = keyOf(JURONG_COMMENT.at)
  const draft = drafts[section]
  const findings = draft.subsections.flatMap((s, i) =>
    s.statements.map((st, j) => {
      const d = decided.get(`${section}|${i}.${j}`)
      return {
        key: `${i}.${j}`,
        text: d?.after ?? st.text,
        citations: st.citations,
        state: d?.action === 'reject' ? 'rejected' : d?.action === 'edit' ? 'edited' : 'pending',
      }
    }),
  )
  const text = sectionText(currentDocument(draft, findings, null))
  const block = text.blocks.find((x) => x.finding === key)!
  const start = text.text.indexOf(JURONG_COMMENT.exact, block.offset)
  const end = start + JURONG_COMMENT.exact.length
  const stamp = (email: string) => {
    const u = USERS.find((x) => x.email === email)!
    return { id: String(users[email]), name: u.name }
  }
  await ReportCommentThreadModel.create({
    assessment: b._id,
    anchor: {
      sectionId: section,
      start,
      end,
      exact: JURONG_COMMENT.exact,
      prefix: text.text.slice(Math.max(0, start - 32), start),
      suffix: text.text.slice(end, end + 32),
    },
    status: 'open',
    comments: JURONG_COMMENT.thread.map((t, i) => ({
      body: t.body,
      by: stamp(t.by === 'MRE-0002' ? 'jide.okafor@example.com' : 'alex.rowe@example.com'),
      at: new Date(b.when.getTime() + (3 * 24 + i) * 3_600_000),
    })),
    createdBy: stamp('jide.okafor@example.com'),
    metadata: {
      source_type: 'report_comment_thread',
      jurisdiction: 'SG',
      facility_type: b.site.facilityType,
      COPE_dimension: draft.metadata.COPE_dimension,
      effective_date: b.when,
    },
  })
}

// Marina Central Tower: a complete report (Sections 2-12) from the office sample in
// seed-cases/, every finding accepted, and the figures for Sections 4 and 5. Finalised and exported.
type OfficeCase = {
  observations: {
    id: string
    COPE_dimension: CopeDimension | CopeDimension[]
    severity: Seen['severity']
    location: string
    note: string
  }[]
  figures: {
    riskQuality: { category: string; current: number | null; potential: number | null }[]
    lossEstimates: unknown
  }
  sections: Record<
    string,
    {
      title: string
      subsections: {
        heading: string
        kind: Sub['kind']
        statements: { text: string; citations: string[] }[]
      }[]
    }
  >
  ofis: { likelihood: string; consequence: string; observations: string[]; [k: string]: unknown }[]
}
const officeCase = () =>
  JSON.parse(
    readFileSync(join(__dirname, 'seed-cases', 'office-5-full-report.json'), 'utf8'),
  ) as OfficeCase

const marinaSeen = (c: OfficeCase) => {
  const toList = (v: CopeDimension | CopeDimension[]) => (Array.isArray(v) ? v : [v])
  const names = [...new Set(c.observations.map((o) => o.location))]
  const places: Record<string, Place> = Object.fromEntries(
    names.map((name) => [name, name === 'Site boundary' ? { name } : { name, building: 'Tower' }]),
  )
  const seen: Seen[] = c.observations.map((o) => ({
    id: o.id,
    at: o.location,
    cope: toList(o.COPE_dimension),
    severity: o.severity,
    note: o.note,
  }))
  return { places, seen }
}

async function finaliseMarina(b: Built, c: OfficeCase) {
  const coped: Record<string, CopeDimension> = {
    '7': 'Construction',
    '8': 'Occupancy',
    '9': 'Protection',
    '10': 'Exposure',
  }
  // Figures first: Sections 4 and 5 are drafted from them (GN-03).
  const figures = {
    riskQuality: {
      categories: c.figures.riskQuality,
      updatedAt: new Date(),
      updatedBy: b.engineer._id,
    },
    lossEstimates: {
      inputs: c.figures.lossEstimates,
      updatedAt: new Date(),
      updatedBy: b.engineer._id,
    },
    ...exported(b, 16),
  }
  await AssessmentModel.updateOne({ _id: b._id }, { $set: figures })
  const evidence = await draftingEvidence(b.reference)
  const drafts: Drafted[] = []
  for (const [id, s] of Object.entries(c.sections))
    drafts.push(
      await saveDraft(
        b,
        id,
        s.title,
        coped[id] ?? 'all',
        s.subsections.map((sub) => ({
          ...sub,
          statements: sub.statements.map((st) => ({ text: st.text, cites: st.citations })),
        })),
        evidence,
        figureFacts(id, figures as never).facts,
      ),
    )
  const ofiMatrix = (l: string, k: string) => RAM[l]?.[k] ?? 'Priority 1'
  await saveOfis(
    b,
    c.ofis.map((o) => ({
      ...o,
      priority: ofiMatrix(o.likelihood, o.consequence),
      cites: o.observations,
    })),
  )
  // Section 2 last: it records which version of each section it summarises (GN-07).
  const assessment = (await AssessmentModel.findById(b._id).lean())!
  const summary = await ReportSectionModel.create({
    assessment: b._id,
    sectionId: '2',
    title: 'Executive Summary',
    subsections: [
      {
        heading: 'Executive Summary',
        kind: 'narrative',
        statements: MARINA_SUMMARY.map((s) => ({ ...s, supported: true })),
      },
      { heading: 'Changes Since Previous Survey', kind: 'narrative', statements: [] },
      { heading: 'Planned Changes / Projects', kind: 'narrative', statements: [] },
    ],
    sources: {},
    questions: [],
    evidence: [],
    summarised: (await currentSections(assessment)).map((s) => ({
      sectionId: s.id,
      version: s.version!,
    })),
    guardrail: { passed: true, unsupported_count: 0 },
    provenance: { ...PROVENANCE, template_version: TEMPLATE_VERSION, generated_at: b.when },
    createdBy: b.engineer._id,
    metadata: {
      source_type: 'report_section',
      jurisdiction: 'SG',
      facility_type: b.site.facilityType,
      COPE_dimension: 'all',
      effective_date: b.when,
    },
    createdAt: b.when,
  })
  await acceptAll(b, [...drafts, summary])
}

// ---- Main -----------------------------------------------------------------

async function main() {
  await connectDb()
  const { name, host } = mongoose.connection
  console.log(`Seeding database "${name}" on ${host}${RESET ? ' (--reset)' : ''}.`)
  if (RESET) await wipe()

  const users = await seedUsers()
  const sites = await seedSites()
  const office = officeCase()
  const marina = marinaSeen(office)
  const ALEX = 'alex.rowe@example.com'
  const JIDE = 'jide.okafor@example.com'

  const cases: Case[] = [
    // Finalised and exported, by a colleague: the earlier report RPT-2026-0005 compares with.
    {
      ref: 'RPT-2026-0001',
      site: 'SG-TCS-001',
      type: 'First survey',
      visit: -240,
      engineer: JIDE,
      stage: 'exported',
      status: 'finalised',
      places: KESTREL_PLACES,
      seen: KESTREL_PREVIOUS_SEEN,
    },
    // Finalised and exported: a complete report.
    {
      ref: 'RPT-2026-0002',
      site: 'SG-MCT-001',
      type: 'First survey',
      visit: -60,
      engineer: ALEX,
      stage: 'exported',
      status: 'finalised',
      places: marina.places,
      seen: marina.seen,
    },
    // Drafted and in review, late.
    {
      ref: 'RPT-2026-0003',
      site: 'SG-JIP-001',
      type: 'First survey',
      visit: -18,
      due: -3,
      engineer: ALEX,
      stage: 'generate',
      status: 'under_review',
      contacts: [{ name: 'Daniel Lim', role: 'EHS manager' }],
      places: JURONG_PLACES,
      seen: JURONG_SEEN,
    },
    // On site now, report due within the week.
    {
      ref: 'RPT-2026-0004',
      site: 'SG-PDC-001',
      type: 'First survey',
      visit: -1,
      visitEnd: 1,
      due: 5,
      engineer: ALEX,
      stage: 'capture',
      contacts: [{ name: 'Mei Ling Tan', role: 'Warehouse manager' }],
      places: PANDAN_PLACES,
      seen: PANDAN_SEEN,
      capture: 'active',
    },
    // A resurvey with an earlier finalised report at the same site, on track.
    {
      ref: 'RPT-2026-0005',
      site: 'SG-TCS-001',
      type: 'Resurvey',
      visit: -4,
      due: 21,
      engineer: ALEX,
      stage: 'capture',
      contacts: [{ name: 'Ravi Menon', role: 'Facilities manager' }],
      places: KESTREL_PLACES,
      seen: KESTREL_CURRENT_SEEN,
      capture: 'active',
    },
    // Scheduled, nothing captured.
    {
      ref: 'RPT-2026-0006',
      site: 'SG-CAW-001',
      type: 'First survey',
      visit: 6,
      due: 20,
      engineer: ALEX,
      stage: 'setup',
      contacts: [{ name: 'Siti Rahman', role: 'Operations manager' }],
    },
    {
      ref: 'RPT-2026-0007',
      site: 'SG-TBP-001',
      type: 'First survey',
      visit: 13,
      due: 27,
      engineer: JIDE,
      stage: 'setup',
      contacts: [{ name: 'Henry Goh', role: 'Plant manager' }],
    },
  ]
  const built: Record<string, Built> = {}
  for (const c of cases) built[c.ref] = await buildCase(c, sites, users)

  await previousKestrel(built['RPT-2026-0001'])
  await finaliseMarina(built['RPT-2026-0002'], office)
  await reviewJurong(built['RPT-2026-0003'], users)

  await CounterModel.updateOne({ _id: 'assessment:2026' }, { $max: { seq: 7 } }, { upsert: true })
  await CounterModel.updateOne({ _id: 'staff' }, { $max: { seq: 4 } }, { upsert: true })

  // Inbox rows read the client and site names as the gateway returns them.
  const clientOf = (code: string) => CLIENTS[SITES.find((s) => s.code === code)!.client].name
  const row = (c: Case) => ({
    id: String(built[c.ref]._id),
    reference: c.ref,
    client: clientOf(c.site),
    site: sites[c.site].name,
    due: c.due === undefined ? undefined : day(c.due).toISOString().slice(0, 10),
  })
  const notices = await seedNotifications(
    users,
    Object.fromEntries(cases.map((c) => [c.ref, row(c)])),
  )
  const calls = await seedUsage(users)

  const count = (m: { countDocuments: () => Promise<number> }) => m.countDocuments()
  console.log(
    [
      `Done. ${USERS.length} accounts (password ${SEED_PASSWORD}), ${CLIENTS.length} clients, ${SITES.length} sites, ${cases.length} assessments.`,
      `${await count(ObservationModel)} observations, ${await count(ReportSectionModel)} section drafts, ${await count(ReportOfiModel)} recommendations, ${await count(ReportCommentThreadModel)} comment thread.`,
      `${notices} notifications, ${calls} AI usage rows (clearly marked demo data).`,
      'Knowledge base and vector store untouched.',
    ].join('\n'),
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await mongoose.disconnect()
    process.exit()
  })
