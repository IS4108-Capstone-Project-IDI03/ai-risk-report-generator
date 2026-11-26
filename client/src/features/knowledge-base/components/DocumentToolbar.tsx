// The Documents list's toolbar (KB-01, IN-17): search, then one filter pill each for source
// type, country, facility type, status and entry, Clear filters once any is set, and Add
// documents at the right end for an admin (v2 "one list frame"). The pills
// are the Clients and Assessments lists' (FilterMenu), so a filter reads the same everywhere.
// Used by screens/KnowledgeDocuments.tsx; filters live in documentFilters.ts.
import { Button, ListToolbar, SearchField } from '../../../design-system'
import { FACILITY_TYPES, JURISDICTIONS } from '../../assessments/options'
import { Tip } from '../../help/Tip'
import { FilterMenu } from '../../clients/components/FilterMenu'
import { STATUS_LOOK } from '../documentStatusLook'
import { GROUPS } from '../documentGroups'
import { NO_FILTERS, type Filters } from '../documentFilters'

// Each filter's own options; the pill adds its "Any …" row. "All countries" is a value of its
// own, so it finds only documents labelled for all countries (exact match, AC4).
const SOURCE = GROUPS.filter((g) => g.sourceType).map((g) => ({
  value: g.sourceType as string,
  label: g.title,
  icon: g.icon,
  color: 'var(--graphite-600)',
}))
const COUNTRY = [{ value: 'all', label: 'All countries' }, ...JURISDICTIONS]
const FACILITY = [
  { value: 'all', label: 'All facility types' },
  ...FACILITY_TYPES.map((value) => ({ value, label: value })),
]
// Each status wears the icon and colour of its pill in the list; a draft is a manual entry.
const STATUS = [
  ...(['active', 'needs_review', 'withdrawn'] as const).map((value) => ({
    value,
    label: STATUS_LOOK[value].label,
    icon: STATUS_LOOK[value].icon,
    color: STATUS_LOOK[value].fg,
  })),
  { value: 'draft', label: 'Draft', icon: undefined, color: undefined },
]
const ENTRY = [
  { value: 'upload', label: 'Uploaded' },
  { value: 'manual', label: 'Manual entry' },
]

/** Returns the toolbar; `onChange` gets the new filters. */
export function DocumentToolbar({
  filters,
  filtering,
  onChange,
  onAdd,
}: {
  filters: Filters
  filtering: boolean
  onChange: (filters: Filters) => void
  // Opens the Add documents tab; left out for a risk engineer (IN-17).
  onAdd?: () => void
}) {
  const set = (change: Partial<Filters>) => onChange({ ...filters, ...change })
  return (
    <ListToolbar
      className="kb-toolbar"
      search={
        <SearchField
          label="Search titles"
          placeholder="Search titles"
          value={filters.title}
          onChange={(e) => set({ title: e.target.value })}
        />
      }
      filters={
        <>
          {/* The spans carry the walkthrough's tags (F-12): a pill has none of its own. */}
          <span className="kb-pill" data-walk="knowledge.filter.source">
            <FilterMenu
              name="Source type"
              choices={SOURCE}
              value={filters.sourceType}
              onChange={(sourceType) => set({ sourceType })}
            />
          </span>
          <span className="kb-pill" data-walk="knowledge.filter.country">
            <FilterMenu
              name="Country"
              icon="globe"
              choices={COUNTRY}
              value={filters.jurisdiction}
              onChange={(jurisdiction) => set({ jurisdiction })}
            />
          </span>
          <span className="kb-pill" data-walk="knowledge.filter.facility">
            <FilterMenu
              name="Facility type"
              icon="building-2"
              choices={FACILITY}
              value={filters.facilityType}
              onChange={(facilityType) => set({ facilityType })}
            />
          </span>
          {/* The status tip (F-13) sits beside its filter. */}
          <span className="kb-pill" data-walk="knowledge.filter.status">
            <FilterMenu
              name="Status"
              choices={STATUS}
              value={filters.status}
              onChange={(status) => set({ status })}
            />
            <Tip id="knowledge.status" />
          </span>
          <FilterMenu
            name="Entry"
            choices={ENTRY}
            value={filters.entry}
            onChange={(entry) => set({ entry })}
          />
          {filtering && (
            <Button variant="ghost" pill onClick={() => onChange(NO_FILTERS)}>
              Clear filters
            </Button>
          )}
        </>
      }
      end={
        onAdd && (
          <Button variant="create" iconLeft="upload" onClick={onAdd}>
            Add documents
          </Button>
        )
      }
    />
  )
}
