// The Section 5 values table (GN-03) read only: its date of values reads as every screen dates a
// day ("31 Dec 2026"), never the stored 2026-12-31.
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { expect, it } from 'vitest'
import { LossValuesTable } from './components/LossValuesTable'

it('shows the date of values as a readable day when read only', () => {
  render(
    <LossValuesTable
      typed={{ currency: 'SGD', dateOfValues: '2026-12-31', indemnityMonths: '12', pd: [], te: [] }}
      totals={{ pd: null, te: null, tiv: null }}
      canEdit={false}
      onChange={() => {}}
    />,
  )
  expect(screen.getByText(/Date of Values:\s*31 Dec 2026/)).toBeInTheDocument()
})
