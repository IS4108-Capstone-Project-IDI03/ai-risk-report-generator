// Settings > Privacy words (PV-09): the knowledge admin's Never masked and Always masked lists,
// and the words past reports had masked. Called by Settings.tsx, for an admin only: Always
// masked names are client data. Calls the privacy word functions in api.ts.
// - Never masked: removing one masks it again (safe), so it goes at once with Undo.
// - Always masked: removing one unmasks a client detail, so it asks first.
// - Masked in reports: each word past reports had masked, to spot one masked by mistake (AC10).
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Callout,
  Dialog,
  Icon,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  Table,
  toast,
} from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import {
  addPrivacyWord,
  getMaskedInReports,
  getPrivacyWords,
  removePrivacyWord,
  type MaskedWord,
  type PrivacyKind,
  type PrivacyList,
  type PrivacyWord,
  type PrivacyWords,
} from '../api'

const message = (error: unknown, fallback: string) =>
  error instanceof GatewayError && error.message ? error.message : fallback

const KINDS: { value: PrivacyKind; label: string }[] = [
  { value: 'CLIENT', label: 'Client' },
  { value: 'SITE', label: 'Site' },
  { value: 'ADDRESS', label: 'Address' },
  { value: 'PERSON', label: 'Person' },
]
const kindLabel = (kind: string | null) =>
  KINDS.find((k) => k.value === kind)?.label ??
  (kind ? kind.charAt(0) + kind.slice(1).toLowerCase() : '')

// "12 Oct 2026" for who added a word.
const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

type View = PrivacyList | 'masked'

// Likely mistakes first: a "person" that looks like a code or a fragment (a digit, a lower-case
// or one- or two-letter word, as "L31" or "alu spandrels w"). Then by how many reports hold it;
// words already on Never masked last.
const suspicious = (w: MaskedWord) =>
  w.kind === 'PERSON' &&
  w.word.split(/\s+/).some((part) => /\d/.test(part) || /^[a-z]/.test(part) || part.length < 3)
const byLikelyMistake = (a: MaskedWord, b: MaskedWord) =>
  Number(a.neverMasked) - Number(b.neverMasked) ||
  Number(suspicious(b)) - Number(suspicious(a)) ||
  b.reports - a.reports ||
  a.word.localeCompare(b.word)

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p className="st-err" role="alert">
      <Icon name="octagon-alert" size={14} color="var(--red-600)" /> {children}
    </p>
  )
}

export function PrivacyWordsSection() {
  const [lists, setLists] = useState<PrivacyWords | null>(null)
  const [problem, setProblem] = useState('')
  const [view, setView] = useState<View>('never')
  const [confirming, setConfirming] = useState<PrivacyWord | null>(null)
  // A word from Masked in reports, put in Never masked's form; `n` remounts the form each time.
  const [prefill, setPrefill] = useState({ word: '', n: 0 })

  const reload = useCallback(
    () =>
      getPrivacyWords().then(setLists, (error: unknown) =>
        setProblem(message(error, 'Could not load the lists.')),
      ),
    [],
  )
  useEffect(() => {
    void reload()
  }, [reload])

  // Never masked: at once, with Undo (re-adds it with its reason).
  const removeNever = async (w: PrivacyWord) => {
    try {
      await removePrivacyWord(w.id)
      await reload()
      toast.success(`${w.word} is masked again`, {
        action: {
          label: 'Undo',
          onClick: () =>
            void addPrivacyWord({ list: 'never', word: w.word, reason: w.reason })
              .then(reload)
              .catch((error: unknown) =>
                toast.error(message(error, `${w.word} could not be put back.`)),
              ),
        },
      })
    } catch (error) {
      toast.error(message(error, `${w.word} was not removed. Try again.`))
    }
  }
  const neverMask = (word: string) => {
    setPrefill((p) => ({ word, n: p.n + 1 }))
    setView('never')
  }

  if (problem) return <Problem>{problem}</Problem>
  if (!lists) return <p className="st-note">Loading…</p>
  return (
    <div className="st-stack">
      {!lists.protectionOn && (
        <Callout tone="info" title="Protection is off">
          These lists take effect only when client details are protected (PII_PROTECTION).
        </Callout>
      )}
      <SegmentedControl<View>
        ariaLabel="List"
        value={view}
        onChange={setView}
        options={[
          { value: 'never', label: 'Never masked', count: lists.never.length },
          { value: 'always', label: 'Always masked', count: lists.always.length },
          { value: 'masked', label: 'Masked in reports' },
        ]}
      />
      {view === 'masked' ? (
        <MaskedInReports onNeverMask={neverMask} />
      ) : (
        <WordList
          list={view}
          words={lists[view]}
          prefill={view === 'never' ? prefill : undefined}
          onAdded={reload}
          onRemove={(w) => (w.list === 'always' ? setConfirming(w) : void removeNever(w))}
        />
      )}
      <History changes={lists.history} />
      {confirming && (
        <ConfirmRemove
          word={confirming}
          onClose={() => setConfirming(null)}
          onRemoved={async () => {
            setConfirming(null)
            await reload()
            toast.success(`${confirming.word} removed from Always masked`)
          }}
        />
      )}
    </div>
  )
}

function WordList({
  list,
  words,
  prefill,
  onAdded,
  onRemove,
}: {
  list: PrivacyList
  words: PrivacyWord[]
  prefill?: { word: string; n: number }
  onAdded: () => Promise<unknown>
  onRemove: (w: PrivacyWord) => void
}) {
  const [filter, setFilter] = useState('')
  // '' is everyone, 'default' the words shipped with the app, otherwise an admin's id.
  const [addedBy, setAddedBy] = useState('')
  const origin = (w: PrivacyWord) => (w.source === 'default' ? 'default' : (w.addedBy?.id ?? ''))
  const origins = [
    ...(words.some((w) => w.source === 'default')
      ? [{ value: 'default', label: 'Shipped with the app' }]
      : []),
    ...[...new Map(words.flatMap((w) => (w.addedBy ? [[w.addedBy.id, w.addedBy.name]] : [])))]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ]
  const shown = words.filter(
    (w) =>
      (!addedBy || origin(w) === addedBy) &&
      `${w.word} ${w.reason}`.toLowerCase().includes(filter.trim().toLowerCase()),
  )
  return (
    <>
      <p className="st-note">
        {list === 'never'
          ? 'Words left as written when client text goes to an AI provider, such as floor codes and equipment the name check mistakes for people.'
          : 'Names masked wherever client text goes to an AI provider, beyond the clients, sites and people the app holds.'}
      </p>
      <AddWord
        key={`${list}-${prefill?.n ?? 0}`}
        list={list}
        initialWord={prefill?.word ?? ''}
        onAdded={onAdded}
      />
      {(words.length > 8 || origins.length > 1) && (
        <div className="st-pw-filters">
          {words.length > 8 && (
            <Input
              label={`Find on ${list === 'never' ? 'Never' : 'Always'} masked`}
              iconLeft="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
          )}
          {origins.length > 1 && (
            <Select
              label="Added by"
              value={addedBy}
              options={[{ value: '', label: 'Anyone' }, ...origins]}
              onChange={(e) => setAddedBy(e.target.value)}
            />
          )}
        </div>
      )}
      <div className="st-pw-table">
        <Table
          dense
          emptyMessage={
            filter || addedBy
              ? 'Nothing matches.'
              : list === 'never'
                ? 'No words yet.'
                : 'No names yet.'
          }
          columns={[
            { key: 'word', header: list === 'never' ? 'Word' : 'Name' },
            ...(list === 'always' ? [{ key: 'kind', header: 'Masked as' }] : []),
            { key: 'reason', header: 'Reason' },
            { key: 'added', header: 'Added' },
            { key: 'remove', header: '', align: 'right' as const, width: 48 },
          ]}
          rows={shown.map((w) => ({
            word: <strong>{w.word}</strong>,
            kind: kindLabel(w.kind),
            reason: w.reason,
            added: (
              <span className="st-pw-added">
                {w.source === 'default'
                  ? 'Shipped with the app'
                  : `${w.addedBy?.name ?? 'An admin'} · ${day(w.at)}`}
              </span>
            ),
            remove: (
              <IconButton
                icon="x"
                size="sm"
                label={`Remove ${w.word}`}
                tooltip="Remove"
                onClick={() => onRemove(w)}
              />
            ),
          }))}
        />
      </div>
    </>
  )
}

// Each word past reports had masked at ingestion, never its tag or which report. Read when
// opened, so it is current after an upload.
function MaskedInReports({ onNeverMask }: { onNeverMask: (word: string) => void }) {
  const [words, setWords] = useState<MaskedWord[] | null>(null)
  const [problem, setProblem] = useState('')
  useEffect(() => {
    getMaskedInReports().then(
      (r) => setWords([...r.words].sort(byLikelyMistake)),
      (error: unknown) => setProblem(message(error, 'Could not load the masked words.')),
    )
  }, [])
  if (problem) return <Problem>{problem}</Problem>
  if (!words) return <p className="st-note">Loading…</p>
  return (
    <>
      <p className="st-note">
        What past reports had masked when they were indexed, likely mistakes first. A word masked by
        mistake, such as a floor code read as a person, can be moved to Never masked. Reports
        already indexed keep their masking until they are run again.
      </p>
      <div className="st-pw-table">
        <Table
          dense
          emptyMessage="No past report has been masked yet."
          columns={[
            { key: 'word', header: 'Word' },
            { key: 'kind', header: 'Masked as' },
            { key: 'reports', header: 'Reports', align: 'right' as const },
            { key: 'action', header: '', align: 'right' as const },
          ]}
          rows={words.map((w) => ({
            word: <strong>{w.word}</strong>,
            kind: kindLabel(w.kind),
            reports: (
              <>
                <span className="st-num">{w.reports}</span>
                {/* The header says Reports; on a phone the header is hidden, so the word shows. */}
                <span className="st-pw-unit"> {w.reports === 1 ? 'report' : 'reports'}</span>
              </>
            ),
            action: w.neverMasked ? (
              <span className="st-muted">Never masked</span>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Never mask ${w.word}`}
                onClick={() => onNeverMask(w.word)}
              >
                Never mask
              </Button>
            ),
          }))}
        />
      </div>
    </>
  )
}

// The last 20 changes, newest first: a record of who did what and why, not something to revert.
function History({ changes }: { changes: PrivacyWords['history'] }) {
  return (
    <div className="st-row">
      <div className="st-row-label">Changes</div>
      {changes.length === 0 ? (
        <p className="st-note">No changes yet.</p>
      ) : (
        <ul className="st-history">
          {changes.map((h, i) => {
            const w = h.after ?? h.before!
            const listName = w.list === 'never' ? 'Never masked' : 'Always masked'
            return (
              <li key={`${h.at}-${i}`}>
                {day(h.at)}, {h.by.name}: {h.after ? 'added' : 'removed'} <strong>{w.word}</strong>{' '}
                {h.after ? 'to' : 'from'} {listName} ({w.reason})
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

type Problems = { word?: string; kind?: string; reason?: string }

// The add form: the word (and on Always masked, its kind) and a reason; Enter adds. A refusal (a
// recorded client, a repeat) shows the gateway's reason under the word and keeps what was typed.
function AddWord({
  list,
  initialWord,
  onAdded,
}: {
  list: PrivacyList
  initialWord: string
  onAdded: () => Promise<unknown>
}) {
  const [word, setWord] = useState(initialWord)
  const [kind, setKind] = useState<PrivacyKind | ''>('')
  const [reason, setReason] = useState('')
  const [problems, setProblems] = useState<Problems>({})
  const [busy, setBusy] = useState(false)
  const wordField = useRef<HTMLInputElement>(null)
  const reasonField = useRef<HTMLInputElement>(null)
  const always = list === 'always'
  // A word brought from Masked in reports needs only its reason.
  useEffect(() => {
    if (initialWord) reasonField.current?.focus()
  }, [initialWord])

  const add = async (event: React.FormEvent) => {
    event.preventDefault()
    const found: Problems = {
      word: word.trim() ? undefined : always ? 'Enter a name.' : 'Enter a word.',
      kind: !always || kind ? undefined : 'Choose what the name is.',
      reason: reason.trim() ? undefined : 'Say why this word is on the list.',
    }
    setProblems(found)
    if (found.word || found.kind || found.reason) return
    setBusy(true)
    try {
      await addPrivacyWord({
        list,
        word: word.trim(),
        ...(always ? { kind: kind as PrivacyKind } : {}),
        reason: reason.trim(),
      })
      setWord('')
      setKind('')
      setReason('')
      await onAdded()
      wordField.current?.focus()
    } catch (error) {
      setProblems({ word: message(error, 'It was not added. Try again.') })
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="st-pw-add" onSubmit={add} noValidate>
      <div className="st-pw-fields">
        <Input
          ref={wordField}
          label={always ? 'Name' : 'Word'}
          size="lg"
          value={word}
          maxLength={80}
          error={problems.word}
          onChange={(e) => setWord(e.target.value)}
        />
        {always && (
          <Select
            label="Masked as"
            size="lg"
            value={kind}
            error={problems.kind}
            options={[{ value: '', label: 'Choose…' }, ...KINDS]}
            onChange={(e) => setKind(e.target.value as PrivacyKind | '')}
          />
        )}
        <Input
          ref={reasonField}
          label="Reason"
          size="lg"
          value={reason}
          maxLength={160}
          error={problems.reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button type="submit" variant="secondary" size="lg" loading={busy}>
          Add
        </Button>
      </div>
      {!always && (
        <p className="st-note st-pw-warn">
          <Icon name="triangle-alert" size={14} color="var(--amber-600)" /> Every flow sends a Never
          masked word to AI providers as written.
        </p>
      )}
    </form>
  )
}

// Removing an Always masked name unmasks a client detail, so it is confirmed first. Focus
// starts on Cancel, so Enter can't remove by accident.
function ConfirmRemove({
  word: w,
  onClose,
  onRemoved,
}: {
  word: PrivacyWord
  onClose: () => void
  onRemoved: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    body.current?.closest('dialog')?.querySelector<HTMLElement>('footer button')?.focus()
  }, [])

  const confirm = async () => {
    setBusy(true)
    setProblem('')
    try {
      await removePrivacyWord(w.id)
      await onRemoved()
    } catch (error) {
      setProblem(message(error, 'Nothing was removed. Try again.'))
      setBusy(false)
    }
  }
  return (
    <Dialog
      className="ds-dialog--v2"
      title={`Remove ${w.word} from Always masked?`}
      width={440}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={confirm}>
            Remove
          </Button>
        </>
      }
    >
      <div ref={body}>
        {problem && (
          <div role="alert">
            <Callout tone="warning" title="Nothing was removed">
              {problem}
            </Callout>
          </div>
        )}
        <p>
          Unless it is a recorded client, site or person, {w.word} will reach AI providers as
          written from the next request on.
        </p>
      </div>
    </Dialog>
  )
}
