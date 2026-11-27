// `npm run seed`: one demo seed that fills an empty app with a few realistic Singapore cases,
// one per stage, so every main screen has something to show. Run by hand, never by the app.
//   npm run seed                        adds or refreshes the demo set (upsert by fixed keys)
//   npm run seed -- --reset             first empties everything except the knowledge base and
//                                       admin settings
//   npm run seed -- --reset --with-ai   also makes the AI content through the app itself: about
//                                       US$1 of paid AI calls and 5 minutes (seed-demo-ai.ts)
// The knowledge base (knowledge documents, ingestion jobs, manual standards, knowledge requests)
// and the vector store are kept: knowledge search needs documents really ingested. --reset only
// deletes the local dev seed's made-up documents, through the app (removeDevSeedDocuments).
// Needs the stack running (`docker compose up`): the two finished reports, RPT-2026-0001 and
// 0002, are exported from their real Export tab in headless Chromium (seed-demo-live.ts), so
// their PDF is real and the Export tab downloads it again. The written report content is fixed
// text (seed-demo-data.ts, seed-cases/); --with-ai never writes AI output into the database
// itself. Without --with-ai, Usage and Costs gets clearly marked demo rows (seed-demo-usage.ts).
// The older per-story seeds (seed:cp23, seed:comparison ...) still work.
import 'dotenv/config'
import bcrypt from 'bcrypt'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import mongoose, { Types } from 'mongoose'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { ChecklistModel } from '../models/checklist.model'
import { ClientDocumentModel } from '../models/client-document.model'
import { ClientModel } from '../models/client.model'
import { CounterModel } from '../models/counter.model'
import { KnowledgeDocumentModel } from '../models/knowledge-document.model'
import { connectDb } from '../models/db'
import { ObservationModel, type CopeDimension } from '../models/observation.model'
import { ReportCommentThreadModel } from '../models/report-comment.model'
import { ReportComparisonModel } from '../models/report-comparison.model'
import { ReportOfiModel } from '../models/report-ofi.model'
import { ReportSectionModel } from '../models/report-section.model'
import { ReviewAuditModel } from '../models/review-audit.model'
import { SiteModel } from '../models/site.model'
import { SiteWalkModel } from '../models/site-walk.model'
import { UserModel } from '../models/user.model'
import { UserSettingsModel } from '../models/user-settings.model'
import { advanceStage } from '../services/assistant/stage'
import type { Stage } from '../services/assistant/types'
import { clientKey } from '../services/client.service'
import { locationKey } from '../services/location.service'
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
  KESTREL_FIGURES,
  KESTREL_PREVIOUS_SEEN,
  KESTREL_REST,
  KESTREL_SUMMARY,
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
import { exportFileName } from '../services/export.service'
import { seedAi } from './seed-demo-ai'
import { exportInBrowser, Gateway, mediaFile } from './seed-demo-live'
import { seedNotifications, seedUsage } from './seed-demo-usage'

const RESET = process.argv.includes('--reset')
const WITH_AI = process.argv.includes('--with-ai')

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

// The local dev seed's made-up knowledge documents (F-12 click-throughs, .local-docs/seed/seed.py):
// no real file behind them, yet every checklist lists them as standards. Found only by the
// fingerprint that seed gives them, and deleted as the admin's Delete does (IN-12), so a real
// document is never touched.
const DEV_SEED_DOCUMENTS = [
  'Practice Warehouse Guide',
  'Practice FM 2.0 Re-upload',
  'Practice Site Notes',
  'Practice Cold Room Code',
]
async function removeDevSeedDocuments(admin: string) {
  const prints = DEV_SEED_DOCUMENTS.map((t) =>
    createHash('sha256').update(`f12-seed:${t}`).digest('hex'),
  )
  const found = await KnowledgeDocumentModel.find({ 'file.sha256': { $in: prints } }, '_id').lean()
  if (!found.length) return
  const sana = await new Gateway(admin).signIn()
  for (const d of found) await sana.call('DELETE', `/knowledge-documents/${d._id}`)
  console.log(`  removed ${found.length} made-up knowledge documents of the local dev seed`)
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
    // What the app made for it on an earlier run (fileClientLetter, --with-ai).
    SiteWalkModel.deleteMany(where),
    ChecklistModel.deleteMany(where),
    ReportComparisonModel.deleteMany(where),
    ClientDocumentModel.deleteMany({ 'placement.assessment': old._id }),
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
  // MarshBot's stage moves only forward and only through advanceStage; the seed writes straight
  // to the database, which the server does not re-check, so it names the stage each fixture's
  // data already proves. Dated as the data was: Ready to export on the day every finding was
  // accepted, "setup" a week before the visit (or now, for a visit still ahead), so the stage
  // dates read in order. Exported comes only from a real export (exportFinished).
  const stageDay = day(c.visit + (c.stage === 'ready_to_export' ? 3 : 0))
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

// ---- The cases ------------------------------------------------------------

// Saves Section 4's scores and Section 5's inputs (GN-03) as the engineer entered them; returns
// them as the drafts of Sections 4 and 5 read them. Before those drafts: they are drafted from it.
async function saveFigures(
  b: Built,
  riskQuality: OfficeCase['figures']['riskQuality'],
  lossEstimates: unknown,
) {
  const figures = {
    riskQuality: { categories: riskQuality, updatedAt: b.when, updatedBy: b.engineer._id },
    lossEstimates: { inputs: lossEstimates, updatedAt: b.when, updatedBy: b.engineer._id },
  }
  await AssessmentModel.updateOne({ _id: b._id }, { $set: figures })
  return figures
}

// Saves Section 2 last: it records which version of each section it summarises (GN-07), so
// it never reads as out of date.
async function saveSummary(b: Built, statements: { text: string; citations: string[] }[]) {
  const assessment = (await AssessmentModel.findById(b._id).lean())!
  return ReportSectionModel.create({
    assessment: b._id,
    sectionId: '2',
    title: 'Executive Summary',
    subsections: [
      {
        heading: 'Executive Summary',
        kind: 'narrative',
        statements: statements.map((s) => ({ ...s, supported: true })),
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
}

// Tuas Cold Store's previous visit, by Jide: a complete report (Sections 2-12), its figures, two
// accepted recommendations and every finding accepted. Finalised; exported later, for real. It is
// what RPT-2026-0005's Comparison tab compares with.
async function previousKestrel(b: Built) {
  const figures = await saveFigures(b, KESTREL_FIGURES.riskQuality, KESTREL_FIGURES.lossEstimates)
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
  for (const [id, s] of Object.entries(KESTREL_REST))
    drafts.push(
      await saveDraft(
        b,
        id,
        s.title,
        'all',
        s.subsections,
        evidence,
        figureFacts(id, figures as never).facts,
      ),
    )
  await saveOfis(b, KESTREL_OFIS)
  drafts.push(await saveSummary(b, KESTREL_SUMMARY))
  await acceptAll(b, drafts)
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
  const figures = await saveFigures(b, c.figures.riskQuality, c.figures.lossEstimates)
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
  await acceptAll(b, [...drafts, await saveSummary(b, MARINA_SUMMARY)])
}

// ---- Through the running app ----------------------------------------------

// Exports a finished report from its Export tab as its engineer would (EX-01), then dates the
// export `after` days after the visit, as the rest of the seed is dated: the file name keeps the
// page count the real PDF has. The gateway records the export and moves the stage to Exported
// itself (recordExport, then its re-check); the seed waits for both before redating them.
async function exportFinished(b: Built, email: string, after: number) {
  const { pages } = await exportInBrowser(email, b.reference)
  const at = new Date(b.when.getTime() + after * 86_400_000)
  for (let i = 0; ; i++) {
    const a = await AssessmentModel.findById(b._id, 'stage exportedAt').lean()
    if (a?.exportedAt && a.stage === 'exported') break
    if (i === 60) throw new Error(`${b.reference} was exported but never reached Exported.`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  await AssessmentModel.updateOne(
    { _id: b._id },
    {
      $set: {
        exportedAt: at,
        exportFile: { fileName: exportFileName(b.reference, 'pdf', at), pages },
        'stageDates.exported': at,
      },
    },
  )
  console.log(`  exported ${b.reference}: ${pages} pages`)
}

// Files the client's letter confirming the resurvey visit under RPT-2026-0005, on the client
// page's Documents tab (CP-23), through the same upload the page uses.
async function fileClientLetter(alex: Gateway, clientId: Id, assessmentId: Id) {
  const form = new FormData()
  form.append(
    'file',
    await mediaFile('resurvey-visit-confirmation.eml', 'message/rfc822'),
    'resurvey-visit-confirmation.eml',
  )
  form.append(
    'placement',
    JSON.stringify({ kind: 'assessment', assessmentId: String(assessmentId) }),
  )
  await alex.call('POST', `/clients/${clientId}/documents`, form)
}

// ---- Main -----------------------------------------------------------------

async function main() {
  await connectDb()
  const { name, host } = mongoose.connection
  console.log(`Seeding database "${name}" on ${host}${RESET ? ' (--reset)' : ''}.`)
  if (RESET) await wipe()

  const users = await seedUsers()
  if (RESET) await removeDevSeedDocuments('sana.patel@example.com')
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
      due: -219,
      engineer: JIDE,
      stage: 'ready_to_export',
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
      due: -39,
      engineer: ALEX,
      stage: 'ready_to_export',
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

  // Through the running app from here on. Jide starts fresh (no walkthrough seen), so his
  // welcome tour is switched off for the export and his settings removed after it: without
  // this, the tour would cover the Export tab, and he would no longer start fresh.
  console.log('Exporting the finished reports and filing a client letter through the app...')
  const jideSettings = { user: String(users[JIDE]) }
  await UserSettingsModel.updateOne(
    jideSettings,
    {
      $set: { 'walkthroughs.welcomeAt': new Date(), 'walkthroughs.offers': false },
      $setOnInsert: {
        metadata: {
          source_type: 'settings',
          jurisdiction: null,
          facility_type: null,
          COPE_dimension: null,
          effective_date: new Date(),
        },
      },
    },
    { upsert: true },
  )
  try {
    await exportFinished(built['RPT-2026-0001'], JIDE, 14)
  } finally {
    await UserSettingsModel.deleteOne(jideSettings)
  }
  await exportFinished(built['RPT-2026-0002'], ALEX, 16)
  const alex = await new Gateway(ALEX).signIn()
  const tuas = (await SiteModel.findById(sites['SG-TCS-001']._id, 'client').lean())!
  await fileClientLetter(alex, tuas.client as Id, built['RPT-2026-0005']._id)
  if (WITH_AI) await seedAi(alex, Object.fromEntries(cases.map((c) => [c.ref, built[c.ref]])))

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
  // Real AI calls were made and recorded: no demo rows beside them.
  const calls = WITH_AI ? 0 : await seedUsage(users)

  const count = (m: { countDocuments: () => Promise<number> }) => m.countDocuments()
  console.log(
    [
      `Done. ${USERS.length} accounts (password ${SEED_PASSWORD}), ${CLIENTS.length} clients, ${SITES.length} sites, ${cases.length} assessments.`,
      `${await count(ObservationModel)} observations, ${await count(ReportSectionModel)} section drafts, ${await count(ReportOfiModel)} recommendations, ${await count(ReportCommentThreadModel)} comment thread.`,
      WITH_AI
        ? `${notices} notifications. AI content made through the app; its cost is on Usage and Costs.`
        : `${notices} notifications, ${calls} AI usage rows (clearly marked demo data).`,
      'Knowledge base kept.',
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
