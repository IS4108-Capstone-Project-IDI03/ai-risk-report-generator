import express from 'express'
import cors from 'cors'
import { config } from './config'
import { connectDb } from './models/db'
import healthRoutes from './routes/health.routes'
import assessmentRoutes from './routes/assessment.routes'
import authRoutes from './routes/auth.routes'
import ingestionRoutes from './routes/ingestion.routes'
import ragRoutes from './routes/rag.routes'
import speechRoutes from './routes/speech.routes'
import userRoutes from './routes/user.routes'

const app = express()

app.use(cors())
app.use(express.json())

app.use('/api/health', healthRoutes)
app.use('/api/assessments', assessmentRoutes)
app.use('/api/auth', authRoutes)
app.use('/api/ingestion', ingestionRoutes)
app.use('/api/rag', ragRoutes)
app.use('/api/speech', speechRoutes)
app.use('/api/users', userRoutes)

async function start() {
  await connectDb()
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
