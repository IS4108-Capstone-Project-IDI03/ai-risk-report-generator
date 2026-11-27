// Our own dropdown list, never a native select (CP-22): a trigger that opens a short menu of
// choices, one or several. The one list behind every dropdown: Select, ChoicePickerField, the
// observation and site walk filters, the engineer picker and the knowledge base's source type.
// The floating surface is Popover (a bottom sheet on a phone). Styles in choice-menu.css.
import {
  Fragment,
  cloneElement,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Icon } from '../core/Icon'
import { Popover } from '../feedback/Popover'
import './choice-menu.css'

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
  // Shown greyed and can't be chosen or reached with the arrow keys.
  disabled?: boolean
}

const ITEMS = '[role^="menuitem"]:not(:disabled), [role="option"]:not(:disabled)'

// Arrow keys move between choices (wrapping), Home/End jump to the ends, as a
// menu should; without this a keyboard user could only Tab through them.
function moveFocus(e: KeyboardEvent<HTMLUListElement>, items: HTMLElement[]) {
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key]
  if (next === undefined || !items.length) return false
  e.preventDefault()
  items[(next + items.length) % items.length].focus()
  return true
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
  sheetCancel = true,
  sheetClassName,
  listbox = false,
  fixed = false,
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
  // Keeps the menu floating on a phone.
  noSheet?: boolean
  // The phone sheet ends in a Cancel button with no close tick (v2 section 6); on unless turned off.
  sheetCancel?: boolean
  // A class on the phone sheet, for the engineer picker's own look (board 09).
  sheetClassName?: string
  // A form field's list (Select): listbox and option roles, so the trigger reads as a combobox.
  listbox?: boolean
  // Floats against the window, at least as wide as the trigger, flipping above it or capped to
  // the room there: a dialog or a scrolling box round the field can never clip or stretch it.
  fixed?: boolean
}) {
  const [open, setOpen] = useState(false)
  // Choices without an icon keep its column when others have one, so labels line up.
  const hasIcons = choices.some((c) => c.icon)
  const list = useRef<HTMLUListElement>(null)
  // Type-ahead: the letters typed in the last half second, and when that run ends.
  const typed = useRef({ text: '', until: 0 })
  // Caps the list to the room below the trigger, so it scrolls instead of running
  // off the screen; without this a phone clipped the last choices. A fixed list is placed and
  // capped by Popover itself.
  useLayoutEffect(() => {
    const ul = list.current
    if (!open || !ul || fixed) return
    // A phone sheet sizes itself, up to 85% of the screen, and scrolls as a whole: capping to the
    // room under the trigger would hide its last rows (measured while the sheet still slides in).
    if (ul.closest('.ds-sheet')) return
    ul.style.maxHeight = ''
    const room = window.innerHeight - ul.getBoundingClientRect().top - 12
    if (room < ul.offsetHeight) ul.style.maxHeight = `${Math.max(room, 132)}px`
    // A left-aligned menu under a chip in the right column ran off the screen, or (CP-24) past
    // the edge of the card it opens in; flip it to the chip's right edge when it would be clipped.
    const surface = ul.closest<HTMLElement>('.ob-menu-surface')
    const edge = surface?.closest('.ob-card')?.getBoundingClientRect().right ?? window.innerWidth
    if (surface && surface.getBoundingClientRect().right > Math.min(edge, window.innerWidth) - 8) {
      surface.style.left = 'auto'
      surface.style.right = '0'
    }
  }, [open, fixed])

  // Arrows, Home and End move; a typed letter jumps to the next choice starting with the letters
  // typed so far (as a native select does).
  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(ITEMS)]
    if (moveFocus(e, items)) return
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey || e.key === ' ') return
    const now = Date.now()
    const run = now < typed.current.until ? typed.current.text : ''
    typed.current = { text: run + e.key.toLowerCase(), until: now + 500 }
    const at = items.indexOf(document.activeElement as HTMLElement)
    // A repeated single letter cycles through the choices with it; a longer run stays put if it fits.
    const from = typed.current.text.length > 1 ? at : at + 1
    const ordered = [...items.slice(Math.max(from, 0)), ...items.slice(0, Math.max(from, 0))]
    const text = typed.current.text
    const hit =
      ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(text)) ??
      (text.split('').every((c) => c === text[0])
        ? ordered.find((el) => el.textContent?.trim().toLowerCase().startsWith(text[0]))
        : undefined)
    if (hit) {
      e.preventDefault()
      hit.focus()
    }
  }

  const control = trigger(open, () => setOpen(!open))
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      // Popover reads aria-haspopup off the trigger; anything else it marks as a dialog.
      trigger={cloneElement(control as ReactElement<Record<string, unknown>>, {
        'aria-haspopup': listbox ? 'listbox' : 'menu',
      })}
      ariaLabel={label}
      align={align}
      className={className}
      surfaceClassName="ob-menu-surface"
      noSheet={noSheet}
      sheetCancel={sheetCancel}
      sheetClassName={sheetClassName}
      fixed={fixed}
      matchWidth={fixed}
    >
      <ul
        ref={list}
        className="ob-menu"
        role={listbox ? 'listbox' : 'menu'}
        aria-label={label}
        aria-multiselectable={listbox && multiple ? true : undefined}
        onKeyDown={onKeyDown}
      >
        {choices.map((c, i) => {
          const on = selected.includes(c.value)
          const state = listbox
            ? { role: 'option', 'aria-selected': on }
            : { role: multiple ? 'menuitemcheckbox' : 'menuitemradio', 'aria-checked': on }
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
                  {...state}
                  disabled={c.disabled}
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
