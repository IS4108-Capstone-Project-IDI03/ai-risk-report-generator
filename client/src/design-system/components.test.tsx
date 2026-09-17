import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import * as UI from './index'

afterEach(cleanup)
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
