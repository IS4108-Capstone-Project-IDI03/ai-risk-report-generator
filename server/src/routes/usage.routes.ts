// EV-04: usage and cost report routes, mounted at /api/usage behind requireAuth.
// Calls services/usage-report.service.ts; the client screen is features/usage/.
import { Router } from 'express'
import { isValidObjectId } from 'mongoose'
import { requirePermission } from '../middleware/auth.middleware'
import {
  OVERVIEW_GROUPS,
  OVERVIEW_RANGES,
  OVERVIEW_SPLITS,
  type OverviewQuery,
  overviewCsv,
  ReportNotInScopeError,
  summarizeUsage,
  usageCsv,
  usageOverview,
} from '../services/usage-report.service'

const router = Router()

const reportIdOf = (query: unknown) => {
  const value = (query as { reportId?: unknown }).reportId
  return typeof value === 'string' && value ? value : undefined
}

const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | undefined =>
  allowed.includes(value as T) ? (value as T) : undefined

// The overview's query, or the reason it is not one. Each part is required, so
// the client always says what it is showing.
function overviewQueryOf(query: Record<string, unknown>): OverviewQuery | string {
  const groupBy = oneOf(OVERVIEW_GROUPS, query.groupBy)
  if (!groupBy) return `groupBy must be one of ${OVERVIEW_GROUPS.join(', ')}.`
  const split = oneOf(OVERVIEW_SPLITS, query.split)
  if (!split) return `split must be one of ${OVERVIEW_SPLITS.join(', ')}.`
  const range = oneOf(OVERVIEW_RANGES, query.range)
  if (!range) return `range must be one of ${OVERVIEW_RANGES.join(', ')}.`
  const engineer = query.engineer
  if (engineer !== undefined && (typeof engineer !== 'string' || !isValidObjectId(engineer)))
    return 'engineer must be a user id.'
  return { groupBy, split, range, ...(engineer ? { engineer: engineer as string } : {}) }
}

router.get('/overview', requirePermission('usage:view'), async (req, res) => {
  const query = overviewQueryOf(req.query)
  if (typeof query === 'string') {
    res.status(400).json({ error: query })
    return
  }
  res.json(await usageOverview(res.locals.user!, query))
})

router.get('/overview/export.csv', requirePermission('usage:view'), async (req, res) => {
  const query = overviewQueryOf(req.query)
  if (typeof query === 'string') {
    res.status(400).json({ error: query })
    return
  }
  const csv = overviewCsv(await usageOverview(res.locals.user!, query))
  // Every part is one of a fixed list, so the name needs no cleaning.
  const name = `usage-by-${query.groupBy}-${query.split}-${query.range}.csv`
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send(csv)
})

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
