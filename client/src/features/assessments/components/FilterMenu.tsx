import { useState } from 'react'
import { Button, Dialog, IconRegistry, Popover, Select } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'

// The Observations tab's filters behind one Filters button, which counts
// those set (CP-06, CP-08, CP-16); chips under the toolbar say which. The
// panel drops down from the button; on a phone it is a bottom sheet with
// larger controls, closed by Show n observations. Each filter applies as it
// is chosen.
export function FilterMenu({ v }: { v: AssessmentWorkflow }) {
  const [open, setOpen] = useState(false)
  const count = v.obsFilterChips.length
  const button = (
    <Button
      variant={count ? 'tonal' : 'secondary'}
      size="sm"
      iconLeft={IconRegistry.action.filter}
      aria-label={count ? 'Filters, ' + count + ' set' : 'Filters'}
      onClick={() => setOpen(!open)}
    >
      {count ? 'Filters · ' + count : 'Filters'}
    </Button>
  )
  if (v.phone)
    return (
      <>
        {button}
        <Dialog
          className="ds-dialog-sheet"
          open={open}
          title="Filters"
          width={440}
          onClose={() => setOpen(false)}
          footer={
            <>
              {!!count && (
                <Button variant="secondary" size="lg" onClick={v.clearObsFilters}>
                  {'Clear filters'}
                </Button>
              )}
              <Button variant="primary" size="lg" onClick={() => setOpen(false)}>
                {v.obsShowLabel}
              </Button>
            </>
          }
        >
          <FilterFields v={v} size="lg" />
        </Dialog>
      </>
    )
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={button} ariaLabel="Filters" align="left">
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <FilterFields v={v} size="sm" />
        {!!count && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="ghost" size="sm" onClick={v.clearObsFilters}>
              {'Clear filters'}
            </Button>
          </div>
        )}
      </div>
    </Popover>
  )
}

// Location first, as the list is grouped by it, then what each observation is.
function FilterFields({ v, size }: { v: AssessmentWorkflow; size: 'sm' | 'lg' }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Select
        size={size}
        label="Location"
        options={v.obsPlaceFilterOptions}
        value={v.obsFilters.place}
        onChange={v.setObsFilter('place')}
      />
      <Select
        size={size}
        label="Type"
        options={v.obsTypeFilterOptions}
        value={v.obsFilters.type}
        onChange={v.setObsFilter('type')}
      />
      <Select
        size={size}
        label="Category"
        options={v.obsCatFilterOptions}
        value={v.obsFilters.cat}
        onChange={v.setObsFilter('cat')}
      />
      <Select
        size={size}
        label="Severity"
        options={v.obsSevFilterOptions}
        value={v.obsFilters.sev}
        onChange={v.setObsFilter('sev')}
      />
      <Select
        size={size}
        label="Status"
        options={v.obsStatusFilterOptions}
        value={v.obsFilters.status}
        onChange={v.setObsFilter('status')}
      />
    </div>
  )
}
