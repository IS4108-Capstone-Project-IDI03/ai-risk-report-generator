// Adding or editing a checklist item (CP-32 AC1-2): what to check, its COPE
// categories and its references, each a passage of the checklist's standards
// found by searching them, with the words it rests on. Adding also asks where
// the item goes. Called by ChecklistItems on the assessment's Checklist tab.
import { useEffect, useRef, useState } from 'react'
import { Button, Callout, Dialog, IconButton, Select, Textarea } from '../../../design-system'
import {
  addChecklistItem,
  editChecklistItem,
  GatewayError,
  searchChecklistPassages,
  type Checklist,
  type ChecklistItem,
  type ChecklistView,
  type FoundPassage,
} from '../api'
import { toggleCategory } from '../categories'
import { caption, muted } from '../checklistChecks'
import { CategoryPicker } from './CategoryPicker'

// Where a new item goes: a report section (and optionally a subsection), or a
// priority risk.
export type ItemPlace = { area: string; subsection: string | null; hazard: string | null }

// A reference as the editor holds it: the passage and the words chosen, and
// what to show of it. `quote` is empty for a passage's first sentence.
type Reference = {
  ref: string
  quote: string
  quoteFound: boolean
  documentId: string | null
  page: number | null
  // A new passage's first sentence, shown until saved: the gateway quotes it.
  shown?: string
}

const errorOf = (failed: unknown, fallback: string) =>
  failed instanceof GatewayError ? failed.message : fallback

// "NFPA 13", as engineers name a standard; its title when it has no number.
function standardName(checklist: Checklist, documentId: string | null | undefined) {
  const s = checklist.standards.find((x) => x.id === documentId)
  if (!s) return 'Standard'
  const issuer = { nfpa_standard: 'NFPA', fm_standard: 'FM' }[s.sourceType ?? '']
  return issuer && s.standardNumber ? `${issuer} ${s.standardNumber}` : s.title
}

// A passage's first sentence, as the gateway quotes a passage chosen without words.
const firstSentence = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return /^.+?[.!?](?=\s|$)/.exec(flat)?.[0] ?? flat
}

// The words selected inside `element`, if any.
function selectedIn(element: HTMLElement | null) {
  const selection = window.getSelection()
  if (!element || !selection || selection.isCollapsed || !selection.rangeCount) return ''
  const range = selection.getRangeAt(0)
  return element.contains(range.commonAncestorContainer) ? selection.toString().trim() : ''
}

// Searching the checklist's standards for a passage, and choosing the words.
function PassagePicker({
  reference,
  checklist,
  start,
  onChoose,
  onBack,
}: {
  reference: string
  checklist: Checklist
  start: string
  onChoose: (passage: FoundPassage, quote: string) => void
  onBack: () => void
}) {
  const [query, setQuery] = useState(start)
  const [results, setResults] = useState<FoundPassage[] | null>(null)
  const [searching, setSearching] = useState(!!start.trim())
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const passageText = useRef<HTMLQuoteElement>(null)
  const failedSearch = (failed: unknown) =>
    setError(errorOf(failed, "Couldn't search the standards. Try again."))
  const search = async (words: string) => {
    if (!words.trim()) return
    setSearching(true)
    setError(null)
    try {
      setResults(await searchChecklistPassages(reference, words.trim()))
      setOpen(null)
    } catch (failed: unknown) {
      failedSearch(failed)
    } finally {
      setSearching(false)
    }
  }
  // Starts from the item's own words, so the nearest passages come first.
  useEffect(() => {
    if (!start.trim()) return
    const controller = new AbortController()
    searchChecklistPassages(reference, start.trim(), controller.signal).then(
      (found) => {
        setResults(found)
        setSearching(false)
      },
      (failed: unknown) => {
        if (controller.signal.aborted) return
        failedSearch(failed)
        setSearching(false)
      },
    )
    return () => controller.abort()
  }, [reference, start])
  const chosen = results?.find((r) => r.ref === open)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          void search(query)
        }}
        style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}
      >
        <div style={{ flex: '1 1 auto' }}>
          <Textarea
            label="Search the standards"
            rows={2}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary" loading={searching} disabled={searching}>
          Search
        </Button>
      </form>
      {error && (
        <Callout tone="danger" title="Not searched">
          {error}
        </Callout>
      )}
      {results && results.length === 0 && (
        <p style={muted}>
          {checklist.standards.length === 0
            ? 'No standards were selected for this checklist, so there is nothing to cite.'
            : 'No passage matches these words. Try other words.'}
        </p>
      )}
      {results && results.length > 0 && (
        <ul
          aria-label="Passages found"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            maxHeight: '44vh',
            overflowY: 'auto',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {results.map((r) => (
            <li key={r.ref} style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <button
                type="button"
                aria-expanded={open === r.ref}
                onClick={() => setOpen(open === r.ref ? null : r.ref)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: 'var(--space-4) var(--space-5)',
                  border: 'none',
                  background: open === r.ref ? 'var(--surface-sunken)' : 'transparent',
                  textAlign: 'left',
                  font: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <span style={{ ...caption, display: 'block' }}>
                  {standardName(checklist, r.documentId)}
                  {r.pageStart != null && ` · p. ${r.pageStart}`}
                  {r.headings.length > 0 && ` · ${r.headings.join(' › ')}`}
                </span>
                {open !== r.ref && (
                  <span
                    style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                      fontSize: 'var(--text-small-size)',
                    }}
                  >
                    {r.text}
                  </span>
                )}
              </button>
              {chosen && open === r.ref && (
                <div style={{ padding: '0 var(--space-5) var(--space-5)' }}>
                  <blockquote
                    ref={passageText}
                    tabIndex={0}
                    aria-label="Passage text"
                    style={{
                      margin: 0,
                      fontFamily: 'var(--font-serif)',
                      fontSize: '14px',
                      lineHeight: '22px',
                      whiteSpace: 'pre-wrap',
                      userSelect: 'text',
                    }}
                  >
                    {chosen.text}
                  </blockquote>
                  <p style={{ ...caption, margin: 'var(--space-3) 0' }}>
                    Select the words the item rests on, or use the first sentence.
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => onChoose(chosen, selectedIn(passageText.current))}
                  >
                    Use this passage
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button variant="link" size="sm" iconLeft="arrow-left" onClick={onBack}>
          Back to the item
        </Button>
      </div>
    </div>
  )
}

export function ChecklistItemEditor({
  reference,
  checklist,
  item,
  place,
  onClose,
  onSaved,
}: {
  reference: string
  checklist: Checklist
  // The item to edit; null to add one at `place`.
  item: ChecklistItem | null
  place: ItemPlace
  onClose: () => void
  onSaved: (view: ChecklistView, message: string) => void
}) {
  const adding = !item
  const [text, setText] = useState(item?.text ?? '')
  const [cats, setCats] = useState<string[]>(item?.COPE_dimension ?? [])
  const [where, setWhere] = useState(place)
  const sources = checklist.sources
  const [refs, setRefs] = useState<Reference[]>(
    (item?.citations ?? []).map((c) => ({
      ...c,
      documentId: sources[c.ref]?.doc_id ?? null,
      page: sources[c.ref]?.page_start ?? null,
    })),
  )
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)

  const template = item?.origin === 'template'
  const missingText = !text.trim()
  const missingCats = cats.length === 0
  const subsections = checklist.items.filter(
    (i) => i.origin === 'template' && i.area === where.area && i.subsection,
  )
  const placeValue = where.area === 'hazards' ? `hazards:${where.hazard}` : where.area

  const save = async () => {
    setTried(true)
    if (missingText || missingCats) return
    setSaving(true)
    setError(null)
    const citations = refs.map((r) => ({ ref: r.ref, quote: r.quote }))
    const sameRefs =
      JSON.stringify(citations) ===
      JSON.stringify((item?.citations ?? []).map((c) => ({ ref: c.ref, quote: c.quote })))
    try {
      if (adding) {
        const added = await addChecklistItem(reference, { ...where, text, COPE_dimension: cats })
        const view = citations.length
          ? await editChecklistItem(reference, added.itemId, { citations })
          : added
        onSaved(view, 'Item added')
      } else {
        const view = await editChecklistItem(reference, item.id, {
          ...(text !== item.text && { text }),
          ...(String(cats) !== String(item.COPE_dimension) && { COPE_dimension: cats }),
          ...(!sameRefs && { citations }),
        })
        onSaved(view, 'Item saved')
      }
    } catch (failed: unknown) {
      setError(errorOf(failed, "Couldn't save the item. Try again."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      title={picking ? 'Choose a reference' : adding ? 'Add item' : 'Edit item'}
      width={620}
      onClose={onClose}
      footer={
        picking ? undefined : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={saving}
              onClick={() => void save()}
            >
              {adding ? 'Add item' : 'Save'}
            </Button>
          </>
        )
      }
    >
      {picking ? (
        <PassagePicker
          reference={reference}
          checklist={checklist}
          start={text || (item ? item.text : '')}
          onBack={() => setPicking(false)}
          onChoose={(passage, quote) => {
            setRefs([
              ...refs.filter((r) => r.ref !== passage.ref),
              {
                ref: passage.ref,
                quote,
                quoteFound: true,
                documentId: passage.documentId,
                page: passage.pageStart,
                shown: quote ? undefined : firstSentence(passage.text),
              },
            ])
            setPicking(false)
          }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
          {adding && (
            <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
              <Select
                label="Where"
                value={placeValue}
                onChange={(event) => {
                  const value = event.target.value
                  setWhere(
                    value.startsWith('hazards:')
                      ? { area: 'hazards', subsection: null, hazard: value.slice(8) }
                      : { area: value, subsection: null, hazard: null },
                  )
                }}
                // Under two headings, as the tab shows them; preset to the
                // card the engineer clicked Add item in.
                options={[
                  ...(checklist.hazards.length
                    ? [
                        {
                          label: 'Priority risks',
                          options: checklist.hazards.map((h) => ({
                            value: `hazards:${h.id}`,
                            label: h.name,
                          })),
                        },
                      ]
                    : []),
                  {
                    label: 'Report sections',
                    options: checklist.areas.map((a) => ({
                      value: a.id,
                      label: `${a.id}. ${a.title}`,
                    })),
                  },
                ]}
              />
              {where.area !== 'hazards' && subsections.length > 0 && (
                <Select
                  label="Subsection"
                  value={where.subsection ?? ''}
                  onChange={(event) =>
                    setWhere({ ...where, subsection: event.target.value || null })
                  }
                  options={[
                    { value: '', label: 'General' },
                    ...subsections.map((i) => ({
                      value: i.subsection!,
                      label: i.subsection!,
                    })),
                  ]}
                />
              )}
            </div>
          )}
          {template && <p style={{ ...muted, fontWeight: 600 }}>{item.subsection}</p>}
          <Textarea
            label={template ? 'What it covers' : 'What to check'}
            rows={3}
            value={text}
            error={tried && missingText ? 'Write what to check.' : undefined}
            onChange={(event) => setText(event.target.value)}
          />
          <div>
            <CategoryPicker
              cats={cats}
              onToggle={(cat) => setCats(toggleCategory(cats, cat))}
              hint={tried && missingCats ? 'Choose at least one category.' : null}
            />
          </div>
          <section aria-label="References">
            <p style={{ ...muted, fontWeight: 600, color: 'var(--text-primary)' }}>References</p>
            {refs.length === 0 && (
              <p style={{ ...caption, marginTop: 'var(--space-2)' }}>
                No reference. Add a passage from the standards this checklist uses.
              </p>
            )}
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {refs.map((r) => (
                <li
                  key={r.ref}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'var(--space-3)',
                    marginTop: 'var(--space-3)',
                    paddingLeft: 'var(--space-4)',
                    borderLeft: '2px solid var(--border-default)',
                  }}
                >
                  <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                    <p style={caption}>
                      {standardName(checklist, r.documentId)}
                      {r.page != null && ` · p. ${r.page}`}
                    </p>
                    <p style={{ ...muted, marginTop: 'var(--space-1)' }}>
                      “{r.quote || r.shown}”
                      {!r.quoteFound && (
                        <span style={{ ...caption, color: 'var(--status-moderate-fg)' }}>
                          {' '}
                          Not word for word in this passage.
                        </span>
                      )}
                    </p>
                  </div>
                  <IconButton
                    icon="x"
                    size="sm"
                    label={`Remove reference ${standardName(checklist, r.documentId)}`}
                    tooltip="Remove reference"
                    onClick={() => setRefs(refs.filter((x) => x.ref !== r.ref))}
                  />
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 'var(--space-4)' }}>
              <Button
                variant="secondary"
                size="sm"
                iconLeft="book-marked"
                disabled={refs.length >= 10}
                onClick={() => setPicking(true)}
              >
                {refs.length ? 'Add another reference' : 'Add reference'}
              </Button>
            </div>
          </section>
          {error && (
            <div role="alert">
              <Callout tone="danger" title="Not saved">
                {error}
              </Callout>
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
}
