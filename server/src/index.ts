import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { config } from './config'
import { connectDb } from './models/db'
import healthRoutes from './routes/health.routes'
import knowledgeDocumentRoutes from './routes/knowledge-document.routes'
import knowledgeGapRoutes from './routes/knowledge-gap.routes'
import assessmentRoutes from './routes/assessment.routes'
import clientRoutes from './routes/client.routes'
import siteRoutes from './routes/site.routes'
import authRoutes from './routes/auth.routes'
import ragRoutes from './routes/rag.routes'
import chatRoutes from './routes/chat.routes'
import observationRoutes from './routes/observation.routes'
import siteWalkRoutes from './routes/site-walk.routes'
import commentRoutes from './routes/comment.routes'
import clientIntakeRoutes from './routes/client-intake.routes'
import clientDocumentRoutes from './routes/client-document.routes'
import assistantRoutes from './routes/assistant.routes'
import assistantEventRoutes from './routes/assistant-events.routes'
import { assistantRecheck } from './middleware/assistant-recheck.middleware'
import { scheduleDailyAssessmentChecks } from './services/assistant/check-queue.service'
import { scheduleIntakeCleanup } from './services/client-intake.service'
import { startWorkers } from './services/job-queue.service'
import { resumeInterruptedSiteWalks } from './services/site-walk.service'
import {
  failInterruptedInterpretations,
  resumeInterruptedTranscriptions,
} from './services/observation.service'
import usageRoutes from './routes/usage.routes'
import userRoutes from './routes/user.routes'
import notificationRoutes from './routes/notification.routes'
import notificationCountRoutes from './routes/notification-count.routes'
import internalNotificationRoutes from './routes/internal-notification.routes'
import internalAiUsageRoutes from './routes/internal-ai-usage.routes'
import internalKnowledgeDocumentRoutes from './routes/internal-knowledge-document.routes'
import { requireAuth, requireAuthNoRefresh } from './middleware/auth.middleware'
import { requireServiceKey } from './middleware/service-auth.middleware'

const app = express()

app.use(cors({ origin: true, credentials: true }))
// A section saved from the document editor (RV-08) may pass the default
// 100 KB, so it is read with a larger limit first; express.json() below then
// leaves the already-read body alone.
const documentSave = /^\/api\/assessments\/[^/]+\/sections\/[^/]+\/document$/
const documentBody = express.json({ limit: '1mb' })
app.use((req, res, next) => (documentSave.test(req.path) ? documentBody(req, res, next) : next()))
// A whole site walk proposal (CP-22) holds up to 500 observations of 5,000
// characters, about 3 MB; without this, autosave and Create all get 413.
const proposalSave = /^\/api\/assessments\/[^/]+\/site-walks\/[^/]+\/proposal$/
const proposalBody = express.json({ limit: '5mb' })
app.use((req, res, next) => (proposalSave.test(req.path) ? proposalBody(req, res, next) : next()))
// A report export (EX-01) carries its laid-out pages, photos included.
const exportRequest = /^\/api\/assessments\/[^/]+\/export$/
const exportBody = express.json({ limit: '64mb' })
app.use((req, res, next) => (exportRequest.test(req.path) ? exportBody(req, res, next) : next()))
app.use(express.json())
app.use(cookieParser())
// MarshBot (AS-06): any successful change to an assessment queues a re-check of its brief.
app.use(assistantRecheck)

// Public: health checks and sign-in itself.
app.use('/api/health', healthRoutes)
app.use('/api/auth', authRoutes)
// Everything else needs a session (401 without one, F-04); each route then
// checks its own permission from the role matrix (403, F-05).
// Before the general assessments router, which would otherwise answer first.
app.use('/api/assessments/:reference/site-walks', requireAuth, siteWalkRoutes)
// Comment threads on the report (RV-03).
app.use('/api/assessments/:reference/comments', requireAuth, commentRoutes)
// MarshBot's event stream (AS-06) checks the session without refreshing it, so
// an open Overview can't keep an idle session alive (F-07). Before the
// assistant router, so this path matches first.
app.use('/api/assessments/:reference/assistant/events', requireAuthNoRefresh, assistantEventRoutes)
// Reading the brief doesn't refresh the session either: an open Overview refetches it on every push.
app.use(
  '/api/assessments/:reference/assistant',
  (req, res, next) => (req.method === 'GET' ? requireAuthNoRefresh : requireAuth)(req, res, next),
  assistantRoutes,
)
app.use('/api/assessments', requireAuth, assessmentRoutes)
app.use('/api/clients', requireAuth, clientRoutes)
app.use('/api/sites', requireAuth, siteRoutes)
app.use('/api/client-intakes', requireAuth, clientIntakeRoutes)
app.use('/api/client-documents', requireAuth, clientDocumentRoutes)
app.use('/api/knowledge-documents', requireAuth, knowledgeDocumentRoutes)
app.use('/api/knowledge-gaps', requireAuth, knowledgeGapRoutes)
app.use('/api/rag', requireAuth, ragRoutes)
app.use('/api/chat', requireAuth, chatRoutes)
app.use('/api/observations', requireAuth, observationRoutes)
app.use('/api/users', requireAuth, userRoutes)
app.use('/api/usage', requireAuth, usageRoutes)
// The count poller runs on a timer, so it authenticates WITHOUT refreshing the
// session — polling must not keep an idle tab logged in (F-07). Mounted before
// the general notifications router so this more specific path matches first.
app.use('/api/notifications/count', requireAuthNoRefresh, notificationCountRoutes)
// Scoped to the caller's own session, not a role capability (no permission).
app.use('/api/notifications', requireAuth, notificationRoutes)
// Service-to-service: authenticated by a shared secret, not a session, so it
// mounts on its own path outside the requireAuth chain above.
app.use('/api/internal/notifications', requireServiceKey, internalNotificationRoutes)
app.use('/api/internal/ai-usage', requireServiceKey, internalAiUsageRoutes)
// GET /api/internal/knowledge-documents/:id/privacy (PV-05): how the ingestion
// worker is to protect a document before it reads it.
app.use('/api/internal/knowledge-documents', requireServiceKey, internalKnowledgeDocumentRoutes)

async function start() {
  await connectDb()
  await failInterruptedInterpretations()
  startWorkers()
  // Not awaited: Redis being slow must not hold up the gateway starting.
  scheduleIntakeCleanup().catch((error: unknown) =>
    console.error('Scheduling the client intake cleanup failed:', error),
  )
  scheduleDailyAssessmentChecks().catch((error: unknown) =>
    console.error('Scheduling the daily assessment checks failed:', error),
  )
  await resumeInterruptedTranscriptions()
  await resumeInterruptedSiteWalks()
  app.listen(config.port, () => {
    console.log(`Gateway listening on port ${config.port}`)
  })
}

// Only boot the server when this file is run directly (`node dist/index.js`,
// `ts-node-dev src/index.ts`) — not when it's imported, e.g. by tests that
// need `app` without a live DB connection or listening port.
if (require.main === module) {
  start().catch((err) => {
    console.error('Failed to start server:', err)
    process.exit(1)
  })
}

export default app
