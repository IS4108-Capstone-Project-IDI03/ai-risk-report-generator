// The "Rejected" pill beside Documents on the filled-in form (Sprint 4 fixes
// CP-23, AC23-AC26): the files that were refused or failed to read, each with
// its short error and the fix, in a popup (a sheet on a phone). Nothing to do
// to a row, so no remove or retry. Used by ClientCard.tsx. Calls ReadingFileRow.tsx.
import { useState } from 'react'
import { Icon, Popover, useIsPhone } from '../../../design-system'
import type { IntakeFile } from '../api'
import { failureOf } from '../reading'
import { ReadingFileRow } from './ReadingFileRow'

// This list drops the full stop that the reading screen's wording ends with.
const noStop = (text: string) => text.replace(/\.$/, '')

export function RejectedPopover({ files }: { files: IntakeFile[] }) {
  const [open, setOpen] = useState(false)
  const phone = useIsPhone()
  if (!files.length) return null
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      ariaLabel="Rejected"
      align="right"
      className="na-docs-anchor"
      surfaceClassName="na-rejected-menu"
      trigger={
        <button
          type="button"
          className="na-docs-btn na-rejected-btn"
          aria-label={'Rejected · ' + files.length}
          onClick={() => setOpen(!open)}
        >
          <Icon name="circle-x" size={16} color="var(--red-600)" />
          <span className="na-docs-word">{'Rejected'}</span>
          <span className="na-count na-count--red">{files.length}</span>
          <Icon name="chevron-down" size={16} className="na-docs-chev" />
        </button>
      }
    >
      <div className="na-docs-pop">
        {/* A phone's sheet already has this as its title. */}
        {!phone && <h3>{'Rejected'}</h3>}
        <ul className="na-files na-rejected-list" aria-label="Rejected documents">
          {files.map((x, k) => {
            const { error, fix, retry } = failureOf(x)
            return (
              <ReadingFileRow
                key={x.name + k}
                plainTile
                row={{
                  key: x.name,
                  name: x.name,
                  state: 'done',
                  failure: { error: noStop(error), fix: noStop(fix), retry },
                }}
              />
            )
          })}
        </ul>
      </div>
    </Popover>
  )
}
