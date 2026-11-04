// CP-23 Check fixes for the shared kit: Chip renders nothing when empty, arrow keys on the
// segmented control and tag picker, and the popover moving focus inside when it opens.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { Chip, Popover, SegmentedControl, TagPicker } from './index'
import { country, fileSize } from '../features/clients/formatClient'

afterEach(cleanup)

it('Chip renders nothing for an empty value', () => {
  const { container } = render(<Chip kind="facility">{null}</Chip>)
  expect(container).toBeEmptyDOMElement()
})

it('SegmentedControl has one tab stop and arrows skip disabled options', () => {
  const onChange = vi.fn()
  render(
    <SegmentedControl
      ariaLabel="Type"
      value="a"
      onChange={onChange}
      options={[
        { value: 'a', label: 'A' },
        { value: 'b', label: 'B', disabled: true },
        { value: 'c', label: 'C' },
      ]}
    />,
  )
  const [a, , c] = screen.getAllByRole('radio')
  expect(a).toHaveAttribute('tabindex', '0')
  expect(c).toHaveAttribute('tabindex', '-1')
  fireEvent.keyDown(a, { key: 'ArrowRight' })
  expect(onChange).toHaveBeenCalledWith('c')
})

it('TagPicker moves focus with Up/Down/Home/End', () => {
  render(
    <TagPicker
      value="x"
      onChange={() => {}}
      options={[
        { value: 'x', label: 'Whole client' },
        { value: 's', label: 'Site', group: 'site' },
        { value: 'r', label: 'Report', group: 'assessment' },
      ]}
    />,
  )
  const [x, s, r] = screen.getAllByRole('option')
  x.focus()
  fireEvent.keyDown(x, { key: 'ArrowDown' })
  expect(s).toHaveFocus()
  fireEvent.keyDown(s, { key: 'End' })
  expect(r).toHaveFocus()
  fireEvent.keyDown(r, { key: 'Home' })
  expect(x).toHaveFocus()
})

function Host() {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={<button onClick={() => setOpen(true)}>Open</button>}
    >
      <TagPicker
        value="s"
        onChange={() => {}}
        options={[
          { value: 'x', label: 'Whole client' },
          { value: 's', label: 'Site', group: 'site' },
        ]}
      />
    </Popover>
  )
}

it('Popover focuses the selected item on open', () => {
  render(<Host />)
  fireEvent.click(screen.getByText('Open'))
  expect(screen.getByRole('option', { name: /Site/ })).toHaveFocus()
})

it('labels a code the list lacks, and sizes in GB', () => {
  expect(country('IE')).toBe('Ireland')
  expect(country('SG')).toBe('Singapore')
  expect(fileSize(2_300_000_000)).toBe('2.3 GB')
})
