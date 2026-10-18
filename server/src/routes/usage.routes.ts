// EV-04: usage and cost report routes, mounted at /api/usage behind requireAuth:
// one report's summary, the overview across assessments or engineers, and the
// knowledge admins' ingestion view, each with its CSV export.
// Calls services/usage-report.service.ts; the client screen is features/usage/.
import { Router } from 'express'
import { isValidObjectId } from 'mongoose'
import { requirePermission } from '../middleware/auth.middleware'
import {
  chatUsage,
  OVERVIEW_GROUPS,
  OVERVIEW_RANGES,
  OVERVIEW_SPLITS,
  ingestionCsv,
  documentUsage,
  type IngestionQuery,
  ingestionUsage,
  type OverviewQuery,
  overviewCsv,
  ratesCsv,
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

// The split and period both views need, or the reason they are not valid.
function ingestionQueryOf(query: Record<string, unknown>): IngestionQuery | string {
  const split = oneOf(OVERVIEW_SPLITS, query.split)
  if (!split) return `split must be one of ${OVERVIEW_SPLITS.join(', ')}.`
  const range = oneOf(OVERVIEW_RANGES, query.range)
  if (!range) return `range must be one of ${OVERVIEW_RANGES.join(', ')}.`
  return { split, range }
}

// The overview's query, or the reason it is not one. Each part is required, so
// the client always says what it is showing.
function overviewQueryOf(query: Record<string, unknown>): OverviewQuery | string {
  const groupBy = oneOf(OVERVIEW_GROUPS, query.groupBy)
  if (!groupBy) return `groupBy must be one of ${OVERVIEW_GROUPS.join(', ')}.`
  const both = ingestionQueryOf(query)
  if (typeof both === 'string') return both
  const { split, range } = both
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

// Document ingestion is the knowledge base's cost, so only knowledge admins see it.
const ingestionAccess = [requirePermission('usage:view'), requirePermission('knowledge:manage')]

router.get('/ingestion', ...ingestionAccess, async (req, res) => {
  const query = ingestionQueryOf(req.query)
  if (typeof query === 'string') {
    res.status(400).json({ error: query })
    return
  }
  res.json(await ingestionUsage(query))
})

router.get('/ingestion/export.csv', ...ingestionAccess, async (req, res) => {
  const query = ingestionQueryOf(req.query)
  if (typeof query === 'string') {
    res.status(400).json({ error: query })
    return
  }
  const csv = ingestionCsv(await ingestionUsage(query))
  // Every part is one of a fixed list, so the name needs no cleaning.
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="usage-ingestion-${query.split}-${query.range}.csv"`,
  )
  res.send(csv)
})

// After export.csv, so that path is not read as a document key.
router.get('/ingestion/:key', ...ingestionAccess, async (req, res) => {
  const usage = await documentUsage(String(req.params.key))
  if (!usage) {
    res.status(404).json({ error: 'No AI calls are recorded for that document.' })
    return
  }
  res.json(usage)
})

router.get('/ingestion/:key/export.csv', ...ingestionAccess, async (req, res) => {
  const usage = await documentUsage(String(req.params.key))
  if (!usage) {
    res.status(404).json({ error: 'No AI calls are recorded for that document.' })
    return
  }
  // The title goes into the file name, so strip anything a header could not carry.
  const name = usage.title.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="usage-document-${name}.csv"`)
  res.send(ratesCsv(usage.rateRows))
})

// The chatbot's cost for a period: a knowledge admin sees everyone's chat, a
// risk engineer their own (the service scopes it).
router.get('/chat', requirePermission('usage:view'), async (req, res) => {
  const range = oneOf(OVERVIEW_RANGES, req.query.range)
  if (!range) {
    res.status(400).json({ error: `range must be one of ${OVERVIEW_RANGES.join(', ')}.` })
    return
  }
  res.json(await chatUsage(res.locals.user!, range))
})

router.get('/chat/export.csv', requirePermission('usage:view'), async (req, res) => {
  const range = oneOf(OVERVIEW_RANGES, req.query.range)
  if (!range) {
    res.status(400).json({ error: `range must be one of ${OVERVIEW_RANGES.join(', ')}.` })
    return
  }
  const csv = ratesCsv((await chatUsage(res.locals.user!, range)).rateRows)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="usage-chat-rates-${range}.csv"`)
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
  const reportId = reportIdOf(req.query)
  if (groupBy !== 'feature' && groupBy !== 'service' && groupBy !== 'rates') {
    res.status(400).json({ error: 'groupBy must be "feature", "service" or "rates".' })
    return
  }
  // Rates are kept per assessment: its usage at the rates charged.
  if (groupBy === 'rates' && !reportId) {
    res.status(400).json({ error: 'groupBy "rates" needs a reportId.' })
    return
  }
  try {
    const summary = await summarizeUsage(res.locals.user!, reportId)
    const csv = groupBy === 'rates' ? ratesCsv(summary.rateRows) : usageCsv(summary, groupBy)
    // The report id goes into the file name, so strip anything a header could not carry.
    const suffix = reportId ? `-${reportId.replace(/[^A-Za-z0-9._-]/g, '_')}` : ''
    const name = groupBy === 'rates' ? `usage-rates${suffix}` : `usage-by-${groupBy}${suffix}`
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`)
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
