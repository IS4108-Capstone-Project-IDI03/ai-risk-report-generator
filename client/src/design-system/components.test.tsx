import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import * as UI from './index'

afterEach(cleanup)
it('lets the browser close a dialog only when it has a way to close', () => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = vi.fn()
  HTMLDialogElement.prototype.close = vi.fn()
  const { rerender } = render(<UI.Dialog title="Stuck" />)
  expect(document.querySelector('dialog')).toHaveAttribute('closedby', 'none')
  rerender(<UI.Dialog title="Closable" onClose={() => {}} />)
  expect(document.querySelector('dialog')).not.toHaveAttribute('closedby')
})

it('renders every shared component and preserves the icon vocabulary', () => {
  render(
    <>
      <UI.Icon name={UI.IconRegistry.action.generate} title="Generate" />
      <UI.Button>Action</UI.Button>
      <UI.IconButton icon="x" label="Close action" />
      <UI.Input label="Input" />
      <UI.Textarea label="Textarea" />
      <UI.Select label="Select" options={['One']} />
      <UI.Checkbox label="Checkbox" />
      <UI.Radio label="Radio" />
      <UI.Switch label="Switch" />
      <UI.Card title="Card">
        <UI.Badge>Badge</UI.Badge>
        <UI.Tag>Tag</UI.Tag>
      </UI.Card>
      <UI.Table columns={[{ key: 'value', header: 'Value' }]} rows={[{ id: '1', value: 'Row' }]} />
      <UI.StatusIcon status="Draft" />
      <UI.PageHeader title="Page" status={<UI.Badge>Ready</UI.Badge>} />
      <UI.MetricStat label="Metric" value={3} />
      <UI.SideNav sections={[{ label: 'Nav', items: [{ value: 'home', label: 'Home' }] }]} />
      <UI.Tabs items={[{ value: 'first', label: 'First' }]} value="first" />
      <UI.Breadcrumb items={[{ label: 'Home' }, { label: 'Current' }]} />
      <UI.Callout title="Callout" />
      <UI.Dialog open={false} />
      <UI.Popover open={false} onOpenChange={() => {}} trigger={<button>Bell</button>} />
      <UI.Toast message="Toast" />
      <UI.EmptyState title="Empty" />
      <UI.ProgressBar label="Complete" value={150} />
      <UI.Tooltip label="Hint">
        <button>Hover</button>
      </UI.Tooltip>
      <UI.AIDraftBlock heading="Draft passage">Prose</UI.AIDraftBlock>
      <UI.EvidenceCitation source="Source" locator="§1" excerpt="Verbatim excerpt" />
      <UI.ConfidenceIndicator level="high" />
    </>,
  )
  expect(screen.getByRole('heading', { name: 'Page' })).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: 'Complete' })).toHaveAttribute(
    'aria-valuenow',
    '100',
  )
  expect(UI.IconRegistry.resolve('action.generate')).toBe('sparkles')
  expect(UI.IconRegistry.resolve('object.notifications')).toBe('bell')
  expect(UI.IconRegistry.resolve('missing.icon')).toBe('circle')
})
it('exposes native checkbox activation and keyboard tab selection', () => {
  const change = vi.fn()
  render(
    <>
      <UI.Checkbox label="Accept terms" checked={false} onChange={change} />
      <UI.Tabs
        items={[
          { value: 'a', label: 'Alpha' },
          { value: 'b', label: 'Beta' },
        ]}
        value="a"
        onChange={change}
      />
    </>,
  )
  fireEvent.click(screen.getByText('Accept terms'))
  expect(change).toHaveBeenCalledExactlyOnceWith(true)
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowRight' })
  expect(change).toHaveBeenLastCalledWith('b')
  expect(screen.getByRole('tab', { name: 'Beta' })).toHaveFocus()
})
it('lists select options under headings and removes a tag with a real button', () => {
  const remove = vi.fn()
  render(
    <>
      <UI.Select
        label="Location"
        options={[
          { value: '', label: 'All locations' },
          { label: 'Block A', options: [{ value: 'lobby', label: 'Lobby' }] },
        ]}
      />
      <UI.Tag onRemove={remove} removeLabel="Remove Severity: High">
        Severity: High
      </UI.Tag>
    </>,
  )
  const heading = screen.getByRole('group', { name: 'Block A' })
  expect(within(heading).getByRole('option', { name: 'Lobby' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Remove Severity: High' }))
  expect(remove).toHaveBeenCalledOnce()
})
it('names a tab with its count apart, keeps a short label’s full name, and scrolls the chosen tab into view', () => {
  const items = [
    { value: 'a', label: 'Overview' },
    { value: 'b', label: 'Sites and assessments', shortLabel: 'Sites' },
    { value: 'c', label: 'Documents', count: 3 },
  ]
  const view = render(<UI.Tabs items={items} value="a" />)
  expect(screen.getByRole('tab', { name: 'Documents, 3' })).toBeInTheDocument()
  expect(screen.getByRole('tab', { name: 'Sites and assessments' })).toHaveTextContent('Sites')

  // A row too narrow for its tabs: the chosen one past the right edge is scrolled to.
  const list = screen.getByRole('tablist')
  const box = (left: number, right: number) => () => ({ left, right }) as DOMRect
  list.getBoundingClientRect = box(0, 200)
  screen.getByRole('tab', { name: 'Documents, 3' }).getBoundingClientRect = box(240, 330)
  view.rerender(<UI.Tabs items={items} value="c" />)
  expect(list.scrollLeft).toBe(130)
})

// CP-23 shared kit.
const TODAY = new Date(2026, 10, 4)
it('shows the four Report due states in their words', () => {
  render(
    <>
      <UI.ReportDue date="2026-10-16" today={TODAY} />
      <UI.ReportDue date="2026-11-09" today={TODAY} />
      <UI.ReportDue date="2026-12-02" today={TODAY} />
      <UI.ReportDue date={null} today={TODAY} />
    </>,
  )
  expect(screen.getByText('19 days late')).toBeInTheDocument()
  expect(screen.getByText('in 5 days')).toBeInTheDocument()
  expect(screen.getByText('in 28 days')).toBeInTheDocument()
  expect(screen.getByText('Not set')).toBeInTheDocument()
  expect(screen.getByText('19 days late').closest('.ds-due')).toHaveClass('ds-due-late')
  expect(screen.getByText('in 5 days').closest('.ds-due')).toHaveClass('ds-due-soon')
  expect(screen.getByText('in 28 days').closest('.ds-due')).toHaveClass('ds-due-ok')
})
it('shows a given second line in place of the day count, never late (Next survey)', () => {
  render(<UI.ReportDue date="2026-10-16" today={TODAY} note="Tuas Distribution Hub" />)
  expect(screen.getByText('16 Oct 2026')).toBeInTheDocument()
  expect(screen.queryByText('19 days late')).not.toBeInTheDocument()
  expect(screen.getByText('Tuas Distribution Hub').closest('.ds-due')).toHaveClass('ds-due-ok')
})
it('leaves the calendar icon out when asked (Clients list Next survey)', () => {
  const { container } = render(
    <UI.ReportDue date="2026-10-16" today={TODAY} note="Tuas Distribution Hub" icon={false} />,
  )
  expect(screen.getByText('16 Oct 2026')).toBeInTheDocument()
  // Only the date and its site line: no icon beside them.
  expect(container.querySelector('.ds-due')?.children).toHaveLength(1)
})
it('covers every assessment status in the status pill', () => {
  const all = [
    'not_started',
    'capturing',
    'ready_to_generate',
    'draft',
    'under_review',
    'finalised',
    'archived',
  ]
  render(
    <>
      {all.map((s) => (
        <UI.StatusPill key={s} status={s} />
      ))}
    </>,
  )
  for (const w of [
    'Not started',
    'Capturing',
    'Ready to generate',
    'Draft',
    'Under review',
    'Finalised',
    'Archived',
  ])
    expect(screen.getByText(w)).toBeInTheDocument()
})
it('does not let a disabled assessment type be chosen', () => {
  const change = vi.fn()
  render(
    <UI.AssessmentTypeControl value="First survey" onChange={change} disabled={['Follow-up']} />,
  )
  expect(screen.getByRole('radio', { name: 'Follow-up' })).toBeDisabled()
  fireEvent.click(screen.getByRole('radio', { name: 'Follow-up' }))
  expect(change).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('radio', { name: 'Resurvey' }))
  expect(change).toHaveBeenCalledWith('Resurvey')
  expect(screen.getByRole('radio', { name: 'First survey' })).toBeChecked()
})
it('ticks the chosen tag and reports a change', () => {
  const change = vi.fn()
  render(
    <UI.TagPicker
      value="c"
      onChange={change}
      options={[
        { value: 'c', label: 'Whole client' },
        { value: 's1', label: 'Tilbury', group: 'site' },
        { value: 'a1', label: 'Tilbury · Resurvey', group: 'assessment' },
      ]}
    />,
  )
  expect(screen.getByText('Sites')).toBeInTheDocument()
  expect(screen.getByText('Assessments')).toBeInTheDocument()
  expect(screen.getByRole('option', { name: 'Whole client' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  fireEvent.click(screen.getByRole('option', { name: 'Tilbury · Resurvey' }))
  expect(change).toHaveBeenCalledWith('a1')
})
it('shows the reading states as words plus a mark, with a tick when done', () => {
  const { container, rerender } = render(
    <UI.ReadingStatus state="working" label="Reading the email" />,
  )
  expect(screen.getByText('Reading the email')).toBeInTheDocument()
  rerender(<UI.ReadingStatus state="waiting" />)
  expect(screen.getByText('Waiting')).toBeInTheDocument()
  rerender(<UI.ReadingStatus state="done" />)
  expect(screen.getByRole('img', { name: 'Done' })).toBeInTheDocument()
  expect(container.querySelector('.ds-reading-words')).toBeNull()
})
it('picks the file tile from the name or the content type', () => {
  expect(UI.fileKind('a.msg')).toBe('email')
  expect(UI.fileKind('a.eml')).toBe('email')
  expect(UI.fileKind('Policy.PDF')).toBe('pdf')
  expect(UI.fileKind('a.docx')).toBe('word')
  expect(UI.fileKind('notes.txt')).toBe('text')
  expect(UI.fileKind('x.zip')).toBe('unknown')
  expect(UI.fileKind('blob', 'application/pdf')).toBe('pdf')
})
it('shows a tag pill with its full text on hover and the late footer part as a button', () => {
  const late = vi.fn()
  render(
    <>
      <UI.TagPill label="A very long site name · Resurvey" />
      <UI.TableFooter late="3 reports late" onLateClick={late}>
        5 assessments
      </UI.TableFooter>
    </>,
  )
  expect(screen.getByTitle('A very long site name · Resurvey')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '3 reports late' }))
  expect(late).toHaveBeenCalled()
})
it('shows a toast with its message and action through the helper', async () => {
  const undo = vi.fn()
  render(<UI.Toaster />)
  act(() => {
    UI.toast.success('Assessment archived', { action: { label: 'Undo', onClick: undo } })
  })
  expect(await screen.findByText('Assessment archived')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  expect(undo).toHaveBeenCalled()
})

it('gives a status the same look by key or by label, and plain grey when unknown', () => {
  expect(UI.statusLook('under_review')).toEqual(UI.statusLook('Under review'))
  expect(UI.statusLook('Under review').icon).toBe('eye')
  expect(UI.statusLook('Paused')).toMatchObject({ label: 'Paused', icon: 'circle' })
})
