// The tag picker (CP-36): Recommendation and Info request, plus the engineer's own sort-only labels.
// No Fact tag: no tag means Fact, and a checkbox says when a Recommendation or Info request also
// states a fact. Suggests tags by itself once the note has 8+ characters and typing pauses (or the
// box is left), once per distinct text. A new observation shows a suggestion pre-selected (dashed,
// sparkle, dismissible); a saved one shows "Suggested: ... Add", never saved without a click.
// Called by screens/SiteObservation.tsx and components/ObservationKinds.tsx. Calls api.suggestKinds.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../design-system'
import { suggestKinds, type Kind } from '../api'
import {
  CHIPS,
  chipsOf,
  KIND_ICON,
  KIND_LABEL,
  kindsFrom,
  LABEL_ICON,
  MAX_LABELS,
  MAX_LABEL_LENGTH,
  sortKinds,
} from '../noteKinds'
import '../kind-picker.css'

// A note shorter than this is too little to suggest from; typing must pause this long first.
const MIN_SUGGEST = 8
const PAUSE_MS = 1200

export function KindPicker({
  value,
  onChange,
  labels = [],
  onLabels,
  reference,
  text,
  blurred = '',
  mode = 'draft',
  disabled = false,
}: {
  // The saved kinds: 'fact' present only when advice or a request also states a fact.
  value: Kind[]
  onChange: (kinds: Kind[]) => void
  labels?: string[]
  // Without it the "+" for labels is not offered (a site walk proposal has none).
  onLabels?: (labels: string[]) => void
  // The assessment; without it (or without text) there is nothing to suggest from.
  reference: string | null | undefined
  // The words to suggest from: the note, or a transcription or description.
  text: string
  // The note as it was when the engineer last left the box; a new value asks at once.
  blurred?: string
  // draft = the new-observation form (suggestion pre-selected); saved = the edit page.
  mode?: 'draft' | 'saved'
  disabled?: boolean
}) {
  const chips = chipsOf(value)
  const alsoFact = value.includes('fact')
  // The suggestion currently shown: on a draft it is also the pre-selected value.
  const [suggested, setSuggested] = useState<Kind[] | null>(null)
  const [touched, setTouched] = useState(value.length > 0)
  const [adding, setAdding] = useState(false)
  const [word, setWord] = useState('')
  // Answers by text, so one text is asked once; null while asked or after a failure (never retried).
  const cache = useRef(new Map<string, Kind[] | null>())
  const live = useRef({ text, touched, disabled, mode, value })
  // Kept current after each render, so an answer arriving later reads the latest values.
  useEffect(() => {
    live.current = { text, touched, disabled, mode, value }
  })

  // Shows an answer if it is still for the current text and the engineer has not taken over.
  function show(words: string, kinds: Kind[] | null | undefined) {
    const now = live.current
    if (!kinds || now.touched || now.disabled || words !== now.text.trim()) return
    const sorted = sortKinds(kinds)
    if (!chipsOf(sorted).length) return // only "Fact": nothing to tag
    if (now.mode === 'draft') {
      if (now.value.length) return
      setSuggested(sorted)
      onChange(sorted)
    } else if (sorted.join() !== now.value.join()) setSuggested(sorted)
  }
  // Asks once per distinct text; any failure leaves the picker as it was.
  async function ask(words: string) {
    if (!reference || live.current.disabled || words.length < MIN_SUGGEST) return
    if (cache.current.has(words)) return show(words, cache.current.get(words))
    cache.current.set(words, null)
    try {
      const kinds = await suggestKinds(reference, words)
      cache.current.set(words, kinds)
      show(words, kinds)
    } catch {
      /* silent: a suggestion is only a help */
    }
  }
  // After a pause in typing.
  useEffect(() => {
    const words = text.trim()
    if (touched || disabled || words.length < MIN_SUGGEST) return
    const timer = setTimeout(() => void ask(words), PAUSE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ask reads what it needs from refs
  }, [text, touched, disabled, reference])
  // On leaving the box.
  useEffect(() => {
    if (blurred && !touched) void ask(blurred.trim())
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new blur asks
  }, [blurred])
  // A new, empty note starts afresh: after Save the next observation may be suggested for again.
  useEffect(() => {
    if (text.trim() || mode !== 'draft') return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resets only when the note empties
    setTouched(false)
    setSuggested(null)
  }, [text, mode])
  // The form was cleared after Save: forget the suggestion's marks.
  const auto = suggested && mode === 'draft' && sortKinds(value).join() === suggested.join()

  const touch = () => {
    setTouched(true)
    setSuggested(null)
  }
  const toggle = (kind: Kind) => {
    touch()
    const next = chips.includes(kind) ? chips.filter((k) => k !== kind) : [...chips, kind]
    onChange(kindsFrom(next, alsoFact))
  }
  const addLabel = () => {
    const l = word.trim().slice(0, MAX_LABEL_LENGTH)
    setWord('')
    if (l && !labels.some((x) => x.toLowerCase() === l.toLowerCase())) onLabels?.([...labels, l])
    if (labels.length + 1 >= MAX_LABELS) setAdding(false)
  }
  return (
    <fieldset className="kp" disabled={disabled}>
      <legend className="kp-legend">{'Tags'}</legend>
      <div className="kp-chips">
        {CHIPS.map((kind) => {
          const on = chips.includes(kind)
          return (
            <button
              key={kind}
              type="button"
              className="kp-chip"
              data-suggested={(on && auto) || undefined}
              aria-pressed={on}
              onClick={() => toggle(kind)}
            >
              <Icon name={KIND_ICON[kind]} size={14} />
              {KIND_LABEL[kind]}
              {on && <Icon name="check" size={14} />}
              {on && auto && <Icon name="sparkles" size={14} color="var(--ai-fg)" />}
              {on && auto && <span className="kp-sr">{'Suggested'}</span>}
            </button>
          )
        })}
        {auto && (
          <button
            type="button"
            className="kp-x"
            aria-label="Dismiss suggested tags"
            onClick={() => {
              touch()
              onChange([])
            }}
          >
            <Icon name="x" size={14} />
          </button>
        )}
        {labels.map((l) => (
          <span key={l} className="kp-label">
            <Icon name={LABEL_ICON} size={12} />
            {l}
            <button
              type="button"
              className="kp-x"
              aria-label={`Remove label ${l}`}
              onClick={() => onLabels?.(labels.filter((x) => x !== l))}
            >
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        {onLabels && labels.length < MAX_LABELS && !adding && (
          <button
            type="button"
            className="kp-add"
            aria-label="Add label"
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" size={16} />
          </button>
        )}
        {onLabels && adding && (
          <input
            className="kp-input"
            aria-label="New label"
            placeholder="Label"
            maxLength={MAX_LABEL_LENGTH}
            autoFocus
            value={word}
            onChange={(e) => setWord(e.target.value)}
            onBlur={() => {
              setAdding(false)
              setWord('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault() // else the form around it would submit
                addLabel()
              } else if (e.key === 'Escape') setAdding(false)
            }}
          />
        )}
      </div>
      {chips.length > 0 && (
        <>
          <label className="kp-also">
            <input
              type="checkbox"
              checked={alsoFact}
              onChange={(e) => {
                touch()
                onChange(kindsFrom(chips, e.target.checked))
              }}
            />
            {'This note also states a fact'}
          </label>
          <p className="kp-hint">
            {alsoFact
              ? 'The report may cite the facts in this note.'
              : 'Advice or a request only: the report never cites it as fact.'}
          </p>
        </>
      )}
      {suggested && mode === 'saved' && (
        <div className="kp-suggest" role="status">
          <Icon name="sparkles" size={14} color="var(--ai-fg)" />
          <span>{'Suggested: ' + suggested.map((k) => KIND_LABEL[k]).join(' + ')}</span>
          <button
            type="button"
            className="kp-suggest-add"
            onClick={() => {
              touch()
              onChange(suggested)
            }}
          >
            {'Add'}
          </button>
          <button
            type="button"
            className="kp-x"
            aria-label="Dismiss suggestion"
            onClick={() => setSuggested(null)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </fieldset>
  )
}
