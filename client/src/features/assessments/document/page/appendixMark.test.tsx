import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { AppendixReport } from './ReportParts'

// Appendix A in Marsh's page layout (GN-07), which the export prints (EX-01):
// a photo the engineer marked shows the mark (CP-10).
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const PHOTO = {
  photoId: 'p1',
  observationId: 'o1',
  name: 'IMG_0460.jpg',
  url: '/api/observations/o1/photos/p1/image',
  location: 'Pump room, B1',
  category: 'Protection',
  note: null,
  selected: true,
}

function serve(photos: object[]) {
  vi.stubGlobal('fetch', () =>
    Promise.resolve(
      new Response(JSON.stringify({ selected: photos, available: photos }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  )
}

it('draws the mark over a marked photo, and gives it to the export', async () => {
  const area = { x: 0.25, y: 0.1, w: 0.5, h: 0.4 }
  serve([{ ...PHOTO, region: area, caption: 'Pump controller' }])

  render(<AppendixReport reference="RPT-1" />)

  const img = await screen.findByRole('img', { name: 'Pump controller' })
  // The export draws it into the printed photo from here (snapshot.ts).
  expect(JSON.parse(img.dataset.region!)).toEqual(area)
  const mark = screen.getByTestId('photo-mark')
  expect([mark.style.left, mark.style.top, mark.style.width, mark.style.height]).toEqual([
    '25%',
    '10%',
    '50%',
    '40%',
  ])
})

it('leaves an unmarked photo as it is', async () => {
  serve([{ ...PHOTO, region: null, caption: 'Pump controller' }])

  render(<AppendixReport reference="RPT-1" />)

  const img = await screen.findByRole('img', { name: 'Pump controller' })
  expect(img).not.toHaveAttribute('data-region')
  expect(screen.queryByTestId('photo-mark')).toBeNull()
})
