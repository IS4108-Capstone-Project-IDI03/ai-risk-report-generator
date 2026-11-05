// How one notification is laid out as an Inbox row (F-10, boards 01, 02 and 07): three lines
// on a desktop (sender, task, detail), two on a phone (task name, then site or short message),
// the tile's icon and colour, and the due date. Called by components/InboxRow.tsx.
import type { Notification } from '../notifications/api'

export type InboxRowModel = {
  sender: string
  task: string
  detail: string
  phoneTask: string
  phoneDetail: string
  icon: string
  tone: 'blue' | 'violet' | 'red' | 'grey'
  // Whether the row has a due date cell at all: an assessment's items do, an admin's don't.
  showsDue: boolean
  // The assessment's report due date (ISO); null when it has none ("Not set").
  due: string | null
}

// A due date that can't be read counts as none: without this ReportDue drew "NaN NaN".
const dueOf = (iso?: string) => (iso && !Number.isNaN(new Date(iso).getTime()) ? iso : null)

// "Review site walk: Pasir Gudang" has the site after the colon; the phone shows the task alone.
const beforeColon = (message: string) => message.split(': ')[0]

// A document's title sits in quotes at the start of the worker's message ('"NFPA 13" needs review.').
const documentTitle = (message: string) => message.match(/^"(.+?)"/)?.[1] ?? 'document'

/** Returns the row's words, icon, tile colour and due date for one Inbox notification. */
export function rowOf(n: Notification): InboxRowModel {
  const c = n.context ?? {}
  switch (n.purpose) {
    case 'assessment_assigned':
      return {
        sender: c.sender ?? '',
        task: n.message,
        detail: c.client ?? '',
        phoneTask: beforeColon(n.message),
        phoneDetail: c.site ?? '',
        icon: 'clipboard-list',
        tone: 'blue',
        showsDue: true,
        due: dueOf(c.reportDue),
      }
    case 'site_walk_ready':
    case 'site_walk_failed': {
      const failed = n.purpose === 'site_walk_failed'
      const detail = failed ? "Couldn't read the recording" : 'Your proposal is ready'
      return {
        sender: 'Site walk',
        task: n.message,
        detail,
        phoneTask: beforeColon(n.message),
        // On a phone a failure says why where a finished walk says which site.
        phoneDetail: failed ? detail : (c.site ?? ''),
        icon: 'mic',
        tone: failed ? 'red' : 'violet',
        showsDue: true,
        due: dueOf(c.reportDue),
      }
    }
    case 'knowledge_gap_request': {
      const question = c.question ?? n.details ?? ''
      return {
        sender: c.askedBy ?? '',
        task: 'Answer knowledge request',
        detail: question,
        phoneTask: 'Answer knowledge request',
        phoneDetail: question,
        icon: 'book-open',
        tone: 'blue',
        showsDue: false,
        due: null,
      }
    }
    case 'ingestion_status': {
      const failed = c.status === 'failed'
      const title = documentTitle(n.message)
      const detail = failed
        ? c.stage
          ? `Failed during ${c.stage}`
          : 'Failed to ingest'
        : (n.details ?? 'Needs review')
      return {
        sender: 'Knowledge base',
        task: `${failed ? 'Retry' : 'Review'} document: ${title}`,
        detail,
        phoneTask: `${failed ? 'Retry' : 'Review'} document`,
        phoneDetail: title,
        icon: failed ? 'file-warning' : 'file-text',
        tone: failed ? 'red' : 'blue',
        showsDue: false,
        due: null,
      }
    }
    default:
      return {
        sender: 'Notification',
        task: n.message,
        detail: n.details ?? '',
        phoneTask: n.message,
        phoneDetail: n.details ?? '',
        icon: 'bell',
        tone: 'grey',
        showsDue: false,
        due: null,
      }
  }
}
