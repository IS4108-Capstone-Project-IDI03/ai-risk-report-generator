// The Passages dialog's filters (IN-17): the search field with its Words | Meaning switch (only
// for an active document: both searches skip the rest), the Chapter and Section menus (one
// Section menu for a past report; our own FilterMenu, never a native select), and Clear filters
// once anything is narrowed. The page range sits in the dialog's header (PassageRange.tsx).
// Used by components/PassagesDialog.tsx; the labels are in passageText.ts.
import { Button, SearchField, SegmentedControl } from '../../../design-system'
import { FilterMenu } from '../../clients/components/FilterMenu'
import { Tip } from '../../help/Tip'
import type { PassageListing, SearchMode } from '../api'
import {
  chapterName,
  named,
  narrowed,
  NO_FILTERS,
  sectionOptions,
  SEARCH_MODES,
  type Filters,
} from '../passageText'

/** Returns the filter bar. */
export function PassageFilters({
  outline,
  filters,
  searchable,
  mode,
  waiting,
  onChange,
  onMode,
  onSearch,
}: {
  outline: PassageListing['outline']
  filters: Filters
  searchable: boolean
  mode: SearchMode
  waiting: boolean
  onChange: (filters: Filters) => void
  onMode: (mode: SearchMode) => void
  onSearch: () => void
}) {
  const byClause = outline.by !== 'section'
  const { chapter, section } = filters
  return (
    <div className="kb-ptoolbar">
      <div className="kb-psearch">
        <div className="kb-psearch-row">
          <SearchField
            label="Search this document"
            placeholder={
              mode === 'meaning'
                ? 'Describe what you’re looking for, then press Enter'
                : 'Search this document'
            }
            enterKeyHint="search"
            disabled={!searchable}
            title={searchable ? undefined : 'Search works once this document is active.'}
            value={filters.words}
            onChange={(e) => onChange({ ...filters, words: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSearch()
            }}
            end={
              <SegmentedControl
                ariaLabel="Search by"
                options={SEARCH_MODES.map((o) => ({ ...o, disabled: !searchable }))}
                value={mode}
                onChange={onMode}
              />
            }
          />
          {/* The Words | Meaning tip (F-13) sits beside the field, not inside it. */}
          <Tip id="knowledge-passages.search" align="right" />
        </div>
        {waiting && <p className="kb-psearch-hint">Press Enter to search</p>}
      </div>
      {/* Values carry a prefix, as "" is a real chapter (front matter) and '' means all. */}
      <div className="kb-pmenus">
        <FilterMenu
          name={byClause ? 'Chapter' : 'Section'}
          anyLabel={byClause ? 'All chapters' : 'All sections'}
          choices={outline.chapters.map((c) => ({
            value: `c:${c.name}`,
            label: `${named(chapterName(c.name, byClause), c.title)} (${c.count.toLocaleString('en')})`,
          }))}
          value={chapter === undefined ? '' : `c:${chapter}`}
          onChange={(v) =>
            onChange({ ...filters, chapter: v ? v.slice(2) : undefined, section: undefined })
          }
        />
        {byClause && (
          <FilterMenu
            name="Section"
            anyLabel="All sections"
            title={chapter === undefined ? 'Choose a chapter first' : undefined}
            disabled={chapter === undefined}
            choices={sectionOptions(outline.sections)}
            value={section === undefined ? '' : `s:${section}`}
            onChange={(v) => onChange({ ...filters, section: v ? v.slice(2) : undefined })}
          />
        )}
        {narrowed(filters) && (
          <Button pill variant="ghost" onClick={() => onChange(NO_FILTERS)}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  )
}
