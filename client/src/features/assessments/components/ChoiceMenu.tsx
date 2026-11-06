// Our own dropdown, never a native select (CP-22): a trigger that opens a
// short menu of choices, one or several. Used by ObservationFilters.tsx and
// ObservationTags.tsx and the site walk screens (site-walk/components/ChoicePill.tsx);
// the floating surface is the design system's Popover.
import {
  Fragment,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Icon, Popover } from '../../../design-system'
import '../observations.css'

// `group` puts a heading above the first choice of each run (e.g. a building).
// `lead` replaces the icon with any element (the engineer picker's avatar), and `trail` is a
// small grey word at the right edge (its role); a row with a trail shows no tick.
export type Choice = {
  value: string
  label: string
  icon?: string
  color?: string
  group?: string
  lead?: ReactNode
  trail?: string
}

// Arrow keys move between choices (wrapping), Home/End jump to the ends, as a
// menu should; without this a keyboard user could only Tab through them.
function moveFocus(e: KeyboardEvent<HTMLUListElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')]
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key]
  if (next === undefined || !items.length) return
  e.preventDefault()
  items[(next + items.length) % items.length].focus()
}

// Returns the trigger and, while open, the menu. A single choice closes the
// menu; with `multiple` it stays open so several can be ticked.
export function ChoiceMenu({
  label,
  trigger,
  choices,
  selected,
  onChoose,
  multiple = false,
  hint,
  align = 'left',
  className,
  noSheet,
  sheetCancel,
  sheetClassName,
}: {
  label: string
  trigger: (open: boolean, toggle: () => void) => ReactElement
  choices: Choice[]
  selected: string[]
  onChoose: (value: string) => void
  multiple?: boolean
  hint?: ReactNode
  align?: 'left' | 'right'
  className?: string
  // Keeps the menu floating on a phone: a sheet would open behind a dialog's top layer.
  noSheet?: boolean
  // The phone sheet ends in a Cancel button (the engineer picker, board 09).
  sheetCancel?: boolean
  // A class on the phone sheet, for the engineer picker's own look (board 09).
  sheetClassName?: string
}) {
  const [open, setOpen] = useState(false)
  // Choices without an icon keep its column when others have one, so labels line up.
  const hasIcons = choices.some((c) => c.icon)
  const list = useRef<HTMLUListElement>(null)
  // Caps the list to the room below the trigger, so it scrolls instead of running
  // off the screen; without this a phone clipped the last choices.
  useLayoutEffect(() => {
    const ul = list.current
    if (!open || !ul) return
    // The engineer picker's phone sheet sizes itself, up to 85% of the screen: capping to the room
    // under the trigger would hide its last rows.
    if (sheetCancel && ul.closest('.ds-sheet')) return
    ul.style.maxHeight = ''
    const room = window.innerHeight - ul.getBoundingClientRect().top - 12
    if (room < ul.offsetHeight) ul.style.maxHeight = `${Math.max(room, 132)}px`
    // A left-aligned menu under a chip in the right column ran off the screen;
    // flip it to the chip's right edge when it would be clipped.
    const surface = ul.closest<HTMLElement>('.ob-menu-surface')
    if (surface && surface.getBoundingClientRect().right > window.innerWidth - 8) {
      surface.style.left = 'auto'
      surface.style.right = '0'
    }
  }, [open, sheetCancel])
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={trigger(open, () => setOpen(!open))}
      ariaLabel={label}
      align={align}
      className={className}
      surfaceClassName="ob-menu-surface"
      noSheet={noSheet}
      sheetCancel={sheetCancel}
      sheetClassName={sheetClassName}
    >
      <ul ref={list} className="ob-menu" role="menu" aria-label={label} onKeyDown={moveFocus}>
        {choices.map((c, i) => {
          const on = selected.includes(c.value)
          return (
            <Fragment key={c.value}>
              {c.group && c.group !== choices[i - 1]?.group && (
                <li role="presentation" className="ob-menu-heading">
                  {c.group}
                </li>
              )}
              <li role="none">
                <button
                  type="button"
                  role={multiple ? 'menuitemcheckbox' : 'menuitemradio'}
                  aria-checked={on}
                  className="ob-menu-item"
                  onClick={() => {
                    onChoose(c.value)
                    if (!multiple) setOpen(false)
                  }}
                >
                  {c.lead ??
                    (c.icon ? (
                      <Icon name={c.icon} size={16} color={c.color} />
                    ) : (
                      <span style={hasIcons ? { width: 16 } : undefined} />
                    ))}
                  <span>{c.label}</span>
                  {c.trail && <span className="ob-menu-trail">{c.trail}</span>}
                  {on && !c.trail && <Icon name="check" size={16} color="var(--marsh-navy)" />}
                </button>
              </li>
            </Fragment>
          )
        })}
      </ul>
      {!!hint && <p className="ob-menu-hint">{hint}</p>}
    </Popover>
  )
}
