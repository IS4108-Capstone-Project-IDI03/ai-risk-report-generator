// Setup (AS-06): details still missing from a new assessment.
import type { CheckContext } from '../context'
import { raise, type RaisedItem } from '../item'

const DETAILS = { tab: 'overview', params: { details: 'open' } } as const

/** Returns a gap for a missing report due date, site contacts and client documents. */
export function setupDetails(ctx: CheckContext): RaisedItem[] {
  if (ctx.stage !== 'setup') return []
  const a = ctx.assessment
  const gap = (id: string, title: string, icon: string, facts: Record<string, number | null>) =>
    raise({
      id: `setup.${id}`,
      kind: 'setup-details',
      stage: 'setup',
      weight: 'gap',
      title,
      detail: 'Not added yet',
      fact: `No ${title.toLowerCase()} added yet.`,
      icon,
      link: DETAILS,
      facts,
    })
  return [
    ...(a.reportDueDate ? [] : [gap('report-due', 'Report Due Date', 'calendar', { due: null })]),
    ...(a.siteContacts?.length
      ? []
      : [gap('site-contacts', 'Site Contacts', 'users', { contacts: 0 })]),
    ...(ctx.documents
      ? []
      : [gap('client-documents', 'Client Documents', 'file-text', { documents: 0 })]),
  ]
}
