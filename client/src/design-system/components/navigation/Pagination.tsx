// Previous / "Page 2 of 49" / Next under a paged table (IN-17, v2 section 2). The host owns
// the page and loads it; this only asks for another. Called by the knowledge base's
// Passages dialog. Calls IconButton.
import { IconButton } from '../core/IconButton'

export type PaginationProps = {
  // The page showing, from 1.
  page: number
  pageCount: number
  onPage: (page: number) => void
}

/** Returns the pager, or nothing when everything fits on one page. */
export function Pagination({ page, pageCount, onPage }: PaginationProps) {
  if (pageCount <= 1) return null
  return (
    <nav className="ds-pagination" aria-label="Pages">
      <IconButton
        icon="chevron-left"
        label="Previous page"
        variant="outline"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      />
      <span className="ds-pagination-place">
        Page <b>{page}</b> of <b>{pageCount}</b>
      </span>
      <IconButton
        icon="chevron-right"
        label="Next page"
        variant="outline"
        size="sm"
        disabled={page >= pageCount}
        onClick={() => onPage(page + 1)}
      />
    </nav>
  )
}
