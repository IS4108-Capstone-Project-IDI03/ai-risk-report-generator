// EV-04: usage and cost report routes, mounted at /api/usage behind requireAuth.
// Calls services/usage-report.service.ts; the client screen is features/usage/.
import { Router } from 'express'
import { requirePermission } from '../middleware/auth.middleware'
import { ReportNotInScopeError, summarizeUsage, usageCsv } from '../services/usage-report.service'

const router = Router()

const reportIdOf = (query: unknown) => {
  const value = (query as { reportId?: unknown }).reportId
  return typeof value === 'string' && value ? value : undefined
}

router.get('/summary', requirePermission('usage:view'), async (req, res) => {
  try {
    res.json(await summarizeUsage(res.locals.user!, reportIdOf(req.query)))
  } catch (error) {
    if (error instanceof ReportNotInScopeError) {
      res.status(403).json({ error: error.message })
      return
    }
    throw error
  }
})

router.get('/export.csv', requirePermission('usage:view'), async (req, res) => {
  const groupBy = req.query.groupBy
  if (groupBy !== 'feature' && groupBy !== 'service') {
    res.status(400).json({ error: 'groupBy must be "feature" or "service".' })
    return
  }
  try {
    const reportId = reportIdOf(req.query)
    const csv = usageCsv(await summarizeUsage(res.locals.user!, reportId), groupBy)
    // The report id goes into the file name, so strip anything a header could not carry.
    const suffix = reportId ? `-${reportId.replace(/[^A-Za-z0-9._-]/g, '_')}` : ''
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="usage-by-${groupBy}${suffix}.csv"`)
    res.send(csv)
  } catch (error) {
    if (error instanceof ReportNotInScopeError) {
      res.status(403).json({ error: error.message })
      return
    }
    throw error
  }
})

export default router
