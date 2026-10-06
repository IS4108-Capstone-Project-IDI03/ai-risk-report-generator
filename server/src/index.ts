import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { config } from './config'
import { connectDb } from './models/db'
import healthRoutes from './routes/health.routes'
import knowledgeDocumentRoutes from './routes/knowledge-document.routes'
import assessmentRoutes from './routes/assessment.routes'
import authRoutes from './routes/auth.routes'
import ragRoutes from './routes/rag.routes'
import observationRoutes from './routes/observation.routes'
import { failInterruptedTranscriptions } from './services/observation.service'
import userRoutes from './routes/user.routes'
import notificationRoutes from './routes/notification.routes'
import { requireAuth } from './middleware/auth.middleware'

const app = express()

app.use(cors({ origin: true, credentials: true }))
app.use(express.json())
app.use(cookieParser())

// Public: health checks and sign-in itself.
app.use('/api/health', healthRoutes)
app.use('/api/auth', authRoutes)
// Everything else needs a session (401 without one, F-04); each route then
// checks its own permission from the role matrix (403, F-05).
app.use('/api/assessments', requireAuth, assessmentRoutes)
app.use('/api/knowledge-documents', requireAuth, knowledgeDocumentRoutes)
app.use('/api/rag', requireAuth, ragRoutes)
app.use('/api/observations', requireAuth, observationRoutes)
app.use('/api/users', requireAuth, userRoutes)
// Scoped to the caller's own session, not a role capability (no permission).
app.use('/api/notifications', requireAuth, notificationRoutes)

async function start() {
  await connectDb()
  await failInterruptedTranscriptions()
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
