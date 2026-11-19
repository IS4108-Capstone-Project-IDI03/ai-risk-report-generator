// The month and the year in the Calendar's heading (CP-60), in the month view: each is a
// button that opens twelve months, or twelve years, to go to (the date picker's MonthYearGrid,
// in a popover; a centred card on a phone). Called by screens/Calendar.tsx.
import { useState } from 'react'
import { Icon, IconButton, MonthYearGrid, Popover } from '../../../design-system'
import { MONTHS } from '../calendar'

type Kind = 'months' | 'years'

export function PeriodPicker({
  year,
  month,
  onGo,
}: {
  // The month shown (0 to 11) and its year.
  year: number
  month: number
  onGo: (year: number, month: number) => void
}) {
  const [open, setOpen] = useState<Kind | null>(null)
  // The year whose months show, or the first of the twelve years.
  const [page, setPage] = useState(year)
  const [animate, setAnimate] = useState<'next' | 'prev' | undefined>()
  const show = (kind: Kind) => {
    if (open === kind) return setOpen(null)
    setAnimate(undefined)
    // This year is fifth among the years, so the years ahead show.
    setPage(kind === 'months' ? year : year - 4)
    setOpen(kind)
  }
  const turn = (by: number) => {
    setAnimate(by > 0 ? 'next' : 'prev')
    setPage((p) => p + by)
  }
  const chooser = (kind: Kind, text: string | number) => {
    const noun = kind === 'months' ? 'month' : 'year'
    const by = kind === 'months' ? 1 : 12
    return (
      <Popover
        open={open === kind}
        onOpenChange={(next) => !next && setOpen(null)}
        ariaLabel={`Choose a ${noun}`}
        align="left"
        sheetCentred
        surfaceClassName="cal-period-surface"
        trigger={
          <button
            type="button"
            className="ds-cal-head-pick cal-period-pick"
            aria-label={`${text}, choose a ${noun}`}
            aria-expanded={open === kind}
            onClick={() => show(kind)}
          >
            {text}
            <Icon name="chevron-down" size={14} />
          </button>
        }
      >
        <div className="ds-cal cal-period-chooser">
          <div className="ds-cal-head">
            <strong>{kind === 'months' ? page : `${page} – ${page + 11}`}</strong>
            <IconButton
              icon="chevron-left"
              label={kind === 'months' ? 'Previous year' : 'Earlier years'}
              onClick={() => turn(-by)}
            />
            <IconButton
              icon="chevron-right"
              label={kind === 'months' ? 'Next year' : 'Later years'}
              onClick={() => turn(by)}
            />
          </div>
          <MonthYearGrid
            kind={kind}
            year={year}
            month={month}
            page={page}
            onPick={(value) => {
              setOpen(null)
              if (kind === 'months') onGo(page, value)
              else onGo(value, month)
            }}
            onPage={turn}
            animate={animate}
          />
        </div>
      </Popover>
    )
  }
  return (
    <>
      {chooser('months', MONTHS[month])} {chooser('years', year)}
    </>
  )
}
