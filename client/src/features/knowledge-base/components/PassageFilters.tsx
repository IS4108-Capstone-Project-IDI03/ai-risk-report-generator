// The Passages dialog's filters (IN-17): the search field with its Words | Meaning switch (only
// for an active document: both searches skip the rest), the Chapter and Section dropdowns (one
// Section dropdown for a past report), the page range, and Clear filters once anything is
// narrowed. Used by components/PassagesDialog.tsx; the labels are in passageText.ts.
import { Button, Input, SearchField, SegmentedControl, Select } from '../../../design-system'
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
  reversed,
  searchable,
  mode,
  waiting,
  onChange,
  onMode,
  onSearch,
}: {
  outline: PassageListing['outline']
  filters: Filters
  reversed: boolean
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
      <Select
        aria-label={byClause ? 'Chapter' : 'Section'}
        options={[
          { value: '', label: byClause ? 'All chapters' : 'All sections' },
          ...outline.chapters.map((c) => ({
            value: `c:${c.name}`,
            label: `${named(chapterName(c.name, byClause), c.title)} (${c.count.toLocaleString('en')})`,
          })),
        ]}
        value={chapter === undefined ? '' : `c:${chapter}`}
        onChange={(e) =>
          onChange({
            ...filters,
            chapter: e.target.value ? e.target.value.slice(2) : undefined,
            section: undefined,
          })
        }
      />
      {byClause && (
        <Select
          aria-label="Section"
          title={chapter === undefined ? 'Choose a chapter first' : undefined}
          disabled={chapter === undefined}
          options={[{ value: '', label: 'All sections' }, ...sectionOptions(outline.sections)]}
          value={section === undefined ? '' : `s:${section}`}
          onChange={(e) =>
            onChange({ ...filters, section: e.target.value ? e.target.value.slice(2) : undefined })
          }
        />
      )}
      <div className="kb-prange">
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          aria-label="From page"
          placeholder="From page"
          value={filters.from}
          onChange={(e) => onChange({ ...filters, from: e.target.value })}
        />
        <span aria-hidden="true">–</span>
        <Input
          type="number"
          min={1}
          inputMode="numeric"
          aria-label="To page"
          placeholder="To page"
          value={filters.to}
          error={reversed ? 'The range ends before it starts.' : undefined}
          onChange={(e) => onChange({ ...filters, to: e.target.value })}
        />
      </div>
      {narrowed(filters) && (
        <Button pill variant="ghost" onClick={() => onChange(NO_FILTERS)}>
          Clear filters
        </Button>
      )}
    </div>
  )
}
