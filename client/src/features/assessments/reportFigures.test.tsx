// Sections 4 and 5's figures in Review (GN-03 AC1-AC3, AC5-AC8): the engineer
// enters scores and values, and sees the gateway's computed figures. The gateway
// is a stubbed fetch.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LossEstimates, ReviewSection, RiskQuality } from './api'
import { DraftEditor } from './components/DraftEditor'
import { railStatus } from './reviewDisplay'
import { LossEstimateFigures } from './components/LossEstimateFigures'
import { RiskQualityFigures } from './components/RiskQualityFigures'
import { describeChanges } from './reviewDisplay'

const CATEGORIES = [
  'External Exposure',
  'Fire Protection',
  'Occupancy Hazards',
  'Construction',
  'Water Supply',
  'Surveillance',
  'Management Programs',
]
const BASIS = {
  weights: CATEGORIES.map((category) => ({ category, weight: 1 / 7 })),
  legend: ['A: 85 to 100', 'B: 70 to 84', 'C: 51 to 69', 'D: 36 to 50', 'E: 0 to 35'],
  rulesVersion: 'rqr-provisional-equal-v1',
}
const BLANK_RQR: RiskQuality = {
  categories: CATEGORIES.map((category) => ({ category, current: null, potential: null })),
  result: { current: null, potential: null, basis: BASIS },
  updatedAt: null,
}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

// Answers GET with `first`, and PUT with what `answer` makes of the body sent.
function gateway(first: unknown, answer: (body: never) => unknown) {
  const puts: unknown[] = []
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    if (init?.method !== 'PUT') return json(first)
    const body = JSON.parse(String(init.body))
    puts.push(body)
    return json(answer(body as never))
  })
  return puts
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Section 4 scores', () => {
  it('shows each category not entered, and no score or rating until all are (AC1)', async () => {
    gateway(BLANK_RQR, () => BLANK_RQR)
    render(<RiskQualityFigures reference="RPT-1" canEdit />)

    const table = await screen.findByRole('table', { name: 'Risk quality scores' })
    const rows = within(table)
      .getAllByRole('rowheader')
      .map((h) => h.textContent)
    expect(rows).toEqual([
      ...CATEGORIES,
      'Location Risk Quality Score',
      'Location Risk Quality Rating',
    ])
    const score = within(table).getByRole('rowheader', { name: 'Location Risk Quality Score' })
    expect(score.closest('tr')).toHaveTextContent('Not entered')
    // The weights are provisional until Marsh's spreadsheet arrives, and say so.
    expect(screen.getByText('Provisional weights')).toBeVisible()
  })

  it('saves the scores and shows the computed score, rating and its basis (AC2, AC3)', async () => {
    const onSaved = vi.fn()
    const puts = gateway(BLANK_RQR, (body: { categories: RiskQuality['categories'] }) => ({
      categories: body.categories,
      result: {
        current: { score: 80, rating: 'B', band: 'B: 70 to 84' },
        potential: { score: 100, rating: 'A', band: 'A: 85 to 100' },
        basis: BASIS,
      },
      updatedAt: '2026-10-14T06:00:00.000Z',
    }))
    render(<RiskQualityFigures reference="RPT-1" canEdit onSaved={onSaved} />)
    await screen.findByRole('table', { name: 'Risk quality scores' })

    for (const category of CATEGORIES) {
      fireEvent.change(screen.getByLabelText(`${category} current score`), {
        target: { value: '8' },
      })
      fireEvent.change(screen.getByLabelText(`${category} potential score`), {
        target: { value: '10' },
      })
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save scores' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(puts[0]).toEqual({
      categories: CATEGORIES.map((category) => ({ category, current: 8, potential: 10 })),
      // GN-12 AC8: the benchmarking scores are saved with the category scores.
      benchmarks: { client: null, peerGroup: null },
    })
    const rating = screen.getByRole('rowheader', { name: 'Location Risk Quality Rating' })
    expect(rating.closest('tr')).toHaveTextContent('BA')
    expect(
      screen.getByRole('rowheader', { name: 'Location Risk Quality Score' }).closest('tr'),
    ).toHaveTextContent('80.0100.0')
    expect(screen.getByText(/rqr-provisional-equal-v1/)).toBeInTheDocument()
  })

  it('outlines in red a potential below its current, or a score outside 0-10, and saves nothing until fixed', async () => {
    const puts = gateway(BLANK_RQR, () => BLANK_RQR)
    render(<RiskQualityFigures reference="RPT-1" canEdit />)
    await screen.findByRole('table', { name: 'Risk quality scores' })
    const box = (category: string, side: string) =>
      screen.getByLabelText(`${category} ${side} score`)

    fireEvent.change(box('Fire Protection', 'current'), { target: { value: '9' } })
    fireEvent.change(box('Fire Protection', 'potential'), { target: { value: '8' } })
    fireEvent.change(box('Construction', 'current'), { target: { value: '11' } })

    // Only the boxes at fault, each with its reason under it.
    expect(box('Fire Protection', 'potential')).toHaveAttribute('aria-invalid', 'true')
    expect(box('Fire Protection', 'current')).toHaveAttribute('aria-invalid', 'false')
    expect(box('Construction', 'current')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Below the current score')).toBeInTheDocument()
    expect(screen.getByText('Enter 0 to 10')).toBeInTheDocument()

    // Saving sends nothing and says once what to do.
    fireEvent.click(screen.getByRole('button', { name: 'Save scores' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Fix the scores outlined in red before saving.',
    )
    expect(puts).toHaveLength(0)

    // Fixed: the outline goes.
    fireEvent.change(box('Fire Protection', 'potential'), { target: { value: '10' } })
    expect(box('Fire Protection', 'potential')).toHaveAttribute('aria-invalid', 'false')
  })

  it('is read-only for anyone but the assigned engineer', async () => {
    gateway(BLANK_RQR, () => BLANK_RQR)
    render(<RiskQualityFigures reference="RPT-1" canEdit={false} />)
    await screen.findByRole('table', { name: 'Risk quality scores' })
    expect(screen.queryByRole('spinbutton')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Save scores' })).toBeNull()
  })
})

const LOSS: LossEstimates = {
  inputs: {
    currency: 'SGD',
    dateOfValues: '2026-01-01',
    indemnityMonths: 12,
    pd: [{ key: 'b', item: 'Buildings', value: 1_000_000 }],
    te: [{ key: 'bi', item: 'Business Interruption', value: 120_000 }],
    levels: [
      { level: 'I', pd: [{ key: 'b', percent: 5 }], te: [{ key: 'bi', months: 1, percent: 100 }] },
    ],
  },
  result: {
    values: { pd: 1_000_000, te: 120_000, tiv: 1_120_000 },
    levels: [
      {
        level: 'I',
        pd: [{ key: 'b', item: 'Buildings', value: 1_000_000, percent: 5, loss: 50_000 }],
        te: [
          {
            key: 'bi',
            item: 'Business Interruption',
            value: 120_000,
            months: 1,
            percent: 100,
            loss: 10_000,
          },
        ],
        pdLoss: 50_000,
        teLoss: 10_000,
        total: 60_000,
      },
      ...(['II', 'III'] as const).map((level) => ({
        level,
        pd: [{ key: 'b', item: 'Buildings', value: 1_000_000, percent: null, loss: null }],
        te: [
          {
            key: 'bi',
            item: 'Business Interruption',
            value: 120_000,
            months: null,
            percent: null,
            loss: null,
          },
        ],
        pdLoss: null,
        teLoss: null,
        total: null,
      })),
    ],
    rulesVersion: 'le-v1',
  },
  updatedAt: '2026-10-14T06:00:00.000Z',
}

describe('Section 5 loss estimates', () => {
  it("lays out Marsh's values, definitions and each level with its computed losses (AC7, AC8)", async () => {
    gateway(LOSS, () => LOSS)
    render(<LossEstimateFigures reference="RPT-1" canEdit />)

    expect(await screen.findByText(/believed to be reasonable, based on industry/)).toBeVisible()
    // One table as in Marsh's template: each PD item beside a TE item.
    const values = screen.getByRole('table', { name: 'Values' })
    const first = within(values).getByDisplayValue('Buildings').closest('tr')!
    expect(within(first).getByDisplayValue('Business Interruption')).toBeInTheDocument()
    expect(
      screen.getByText('Total Insurable Values (TIV) / Total Sums Insured (TSI)').closest('tr'),
    ).toHaveTextContent('1,120,000')
    expect(screen.getByRole('table', { name: 'Loss Estimate Definitions' })).toHaveTextContent(
      'Primary Protection Systems are functioning and manual firefighting available',
    )

    const one = screen.getByRole('region', { name: 'Property – Level I Loss Estimate' })
    expect(within(one).getByText('Normal Loss Expectancy')).toBeVisible()
    const pd = within(one).getByRole('table', { name: 'Level I Property Damage' })
    expect(
      within(pd)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Property Damage', 'Value', '% Damage', 'Property Damage'])
    expect(within(pd).getByDisplayValue('Buildings').closest('tr')).toHaveTextContent('50,000')
    expect(
      within(one).getByText('Total Level I Property Loss Estimate').closest('tr'),
    ).toHaveTextContent('60,000')
    // The rule behind each figure (AC7).
    expect(within(one).getByText(/value × % damage/)).toBeInTheDocument()

    // A level not yet entered makes up nothing (AC1).
    const two = screen.getByRole('region', { name: 'Property – Level II Loss Estimate' })
    expect(
      within(two).getByText('Total Level II Property Loss Estimate').closest('tr'),
    ).toHaveTextContent('Not entered')
  })

  it('outlines in red a negative figure, a % over 100 or months beyond the indemnity period, and saves nothing until fixed', async () => {
    const puts = gateway(LOSS, () => LOSS)
    render(<LossEstimateFigures reference="RPT-1" canEdit />)
    const one = await screen.findByRole('region', { name: 'Property – Level I Loss Estimate' })
    const values = screen.getByRole('table', { name: 'Values' })

    fireEvent.change(within(values).getByLabelText('Buildings value'), { target: { value: '-5' } })
    fireEvent.change(within(one).getByLabelText('Buildings % damage'), { target: { value: '150' } })
    // 13 months against the 12-month indemnity period.
    fireEvent.change(within(one).getByLabelText('Business Interruption outage months'), {
      target: { value: '13' },
    })

    expect(within(values).getByLabelText('Buildings value')).toHaveAttribute('aria-invalid', 'true')
    expect(within(one).getByLabelText('Buildings % damage')).toHaveAttribute('aria-invalid', 'true')
    expect(within(one).getByLabelText('Business Interruption outage months')).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    expect(screen.getByText('Enter 0 or more')).toBeInTheDocument()
    expect(screen.getByText('Enter 0 to 100')).toBeInTheDocument()
    expect(screen.getByText('More than the indemnity period')).toBeInTheDocument()
    // A valid box is left alone.
    expect(within(one).getByLabelText('Business Interruption % impacted')).toHaveAttribute(
      'aria-invalid',
      'false',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save figures' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Fix the figures outlined in red before saving.',
    )
    expect(puts).toHaveLength(0)
  })

  it('edits, adds and removes damage items in one level without changing site values or other levels', async () => {
    const puts = gateway(LOSS, () => LOSS)
    render(<LossEstimateFigures reference="RPT-1" canEdit />)
    const one = await screen.findByRole('region', { name: 'Property – Level I Loss Estimate' })
    fireEvent.change(within(one).getByLabelText('Level I damage item 1'), {
      target: { value: 'Floors 27–29' },
    })
    fireEvent.change(within(one).getByLabelText('Level I damage value 1'), {
      target: { value: '300000' },
    })
    fireEvent.click(within(one).getByRole('button', { name: 'Add a damage item to Level I' }))
    fireEvent.change(within(one).getByLabelText('Level I damage item 2'), {
      target: { value: 'Roof' },
    })
    fireEvent.click(within(one).getByRole('button', { name: 'Remove damage item 2 from Level I' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save figures' }))
    await waitFor(() => expect(puts).toHaveLength(1))
    const sent = puts[0] as LossEstimates['inputs']
    expect(sent.pd).toEqual(LOSS.inputs.pd)
    expect(sent.levels[0].damageRows).toEqual([
      {
        key: 'b',
        item: 'Floors 27–29',
        value: 300000,
        percent: 5,
      },
    ])
    expect(sent.levels[1].damageRows?.[0]).toMatchObject({ item: 'Buildings', value: 1000000 })
  })

  it('saves the values and each level’s % and months as numbers (AC5, AC6)', async () => {
    const onSaved = vi.fn()
    const puts = gateway(LOSS, () => LOSS)
    render(<LossEstimateFigures reference="RPT-1" canEdit onSaved={onSaved} />)
    const two = await screen.findByRole('region', { name: 'Property – Level II Loss Estimate' })

    fireEvent.change(within(two).getByLabelText('Buildings % damage'), { target: { value: '30' } })
    fireEvent.change(within(two).getByLabelText('Business Interruption outage months'), {
      target: { value: '6' },
    })
    fireEvent.change(within(two).getByLabelText('Business Interruption % impacted'), {
      target: { value: '50' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add a property damage value' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save figures' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const sent = puts[0] as LossEstimates['inputs']
    expect(sent.currency).toBe('SGD')
    expect(sent.pd).toHaveLength(2)
    expect(sent.pd[1]).toMatchObject({ item: '', value: null })
    expect(sent.levels.find((l) => l.level === 'II')).toEqual({
      level: 'II',
      pd: [],
      damageRows: [
        {
          key: 'b',
          item: 'Buildings',
          value: 1_000_000,
          percent: 30,
        },
      ],
      te: [{ key: 'bi', months: 6, percent: 50 }],
    })
  })
})

it('says when Section 4 or 5’s figures changed since the draft', () => {
  expect(describeChanges({ added: 0, changed: 0, removed: 0, figures: 1 })).toBe(
    'The figures changed',
  )
  expect(describeChanges({ added: 2, changed: 0, removed: 0, figures: 1 })).toBe(
    '2 observations added and the figures changed',
  )
})

it('shows the figures above Section 4’s drafted comments, and Marsh’s lead-in to the positive points', () => {
  const statement = (text: string) => ({
    text,
    citations: ['O:o1'],
    supported: true,
    generatedText: text,
    review: { state: 'pending' as const, at: null, by: null },
  })
  const section: ReviewSection = {
    id: '4',
    title: 'Risk Quality Ratings and Comments',
    copeDimensions: CATEGORIES,
    completion: { state: 'complete', written: 2, total: 2, tables: 0 },
    review: {
      state: 'needs_review',
      unsupportedStatements: 0,
      withdrawnSources: 0,
      changesSinceDraft: 0,
      changeCounts: { added: 0, changed: 0, removed: 0 },
    },
    draft: {
      id: 'd4',
      sectionId: '4',
      title: 'Risk Quality Ratings and Comments',
      subsections: [
        {
          heading: 'Risk Quality Rating Comments',
          kind: 'narrative',
          statements: [statement('Above average risk of its class.')],
        },
        {
          heading: 'Positive Points',
          kind: 'narrative',
          statements: [statement('Good housekeeping observed for all areas visited.')],
        },
      ],
      questions: [],
      guardrail: { passed: true, unsupported_count: 0 },
      provenance: {
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        effort: 'high',
        prompt_version: 'gn01-v2.6',
        template_version: 'global-pre-v2.0-2026-02',
        generated_at: '2026-10-14T06:00:00.000Z',
      },
      createdAt: '2026-10-14T06:00:00.000Z',
    },
    sources: {},
    observations: [],
    findings: { total: 2, pending: 2, accepted: 0, edited: 0, rejected: 0 },
    replacement: null,
    history: [],
  }
  render(
    <DraftEditor
      section={section}
      position="4 of 12"
      onGenerate={() => {}}
      numbers={new Map([['O:o1', 1]])}
      focus={{ citation: null, statement: null }}
      describe={() => 'Site observation'}
      onCite={() => {}}
      figures={<p>Scores table</p>}
    />,
  )

  const editor = screen.getByRole('region', { name: 'Draft editor' })
  const text = editor.textContent ?? ''
  expect(text.indexOf('Scores table')).toBeLessThan(text.indexOf('Above average'))
  expect(text.indexOf('The positive points from the visit are the following:')).toBeLessThan(
    text.indexOf('Good housekeeping'),
  )
})

it('says which rule a refused save broke', async () => {
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? new Response(
          JSON.stringify({
            error: 'The values are invalid.',
            fields: { '': 'Level III: outage months exceed the indemnity period.' },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      : json(LOSS),
  )
  render(<LossEstimateFigures reference="RPT-1" canEdit />)
  fireEvent.click(await screen.findByRole('button', { name: 'Save figures' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The values are invalid. Level III: outage months exceed the indemnity period.',
  )
})

it('says each refused rule once, however many rows broke it', async () => {
  const rule = 'The potential score cannot be below the current score.'
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) =>
    init?.method === 'PUT'
      ? new Response(
          JSON.stringify({
            error: 'The values are invalid.',
            fields: { 'levels.0': rule, 'levels.1': rule, 'levels.2': rule },
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      : json(LOSS),
  )
  render(<LossEstimateFigures reference="RPT-1" canEdit />)
  fireEvent.click(await screen.findByRole('button', { name: 'Save figures' }))

  expect(await screen.findByRole('alert')).toHaveTextContent(`The values are invalid. ${rule}`)
  expect(screen.getByRole('alert').textContent!.split(rule)).toHaveLength(2)
})

it("puts each level's drafted scenario and assumptions in its definition table, as Marsh's template", async () => {
  gateway(LOSS, () => LOSS)
  const drafted = new Map([
    ['Level I Scenario', <p key="s">A fire starts in the server room.</p>],
    ['Level I Assumptions', <p key="a">Damage stays in the room.</p>],
  ])
  render(<LossEstimateFigures reference="RPT-1" canEdit drafted={drafted} />)

  const one = await screen.findByRole('region', { name: 'Property – Level I Loss Estimate' })
  const table = within(one).getByRole('table', { name: 'Level I Normal Loss Expectancy' })
  const row = (name: string) => within(table).getByRole('rowheader', { name }).closest('tr')!
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent),
  ).toEqual([
    'Definition',
    'Definition: Primary Protection Systems are functioning and manual firefighting available',
  ])
  expect(row('Scenario')).toHaveTextContent('A fire starts in the server room.')
  expect(row('Assumptions')).toHaveTextContent('Damage stays in the room.')
  expect(row('Limitations')).toBeInTheDocument()
  // A level not drafted yet says so in its cells.
  const two = screen.getByRole('region', { name: 'Property – Level II Loss Estimate' })
  expect(within(two).getByRole('rowheader', { name: 'Scenario' }).closest('tr')).toHaveTextContent(
    'Not drafted yet',
  )
})

it("hands Section 5's findings to its figures, so each sits in its level's table, decisions included", () => {
  const statement = (text: string) => ({
    text,
    citations: ['O:o1'],
    supported: true,
    generatedText: text,
    review: { state: 'pending' as const, at: null, by: null },
  })
  const section: ReviewSection = {
    id: '5',
    title: 'Loss Estimates',
    copeDimensions: CATEGORIES,
    completion: { state: 'complete', written: 1, total: 6, tables: 0 },
    review: {
      state: 'needs_review',
      unsupportedStatements: 0,
      withdrawnSources: 0,
      changesSinceDraft: 0,
      changeCounts: { added: 0, changed: 0, removed: 0 },
    },
    draft: {
      id: 'd5',
      sectionId: '5',
      title: 'Loss Estimates',
      subsections: [
        {
          heading: 'Level I Scenario',
          kind: 'narrative',
          statements: [statement('A fire starts in the server room.')],
        },
      ],
      questions: [],
      guardrail: { passed: true, unsupported_count: 0 },
      provenance: {
        provider: 'anthropic',
        model: 'claude-opus-5-5',
        effort: 'high',
        prompt_version: 'gn01-v2.6',
        template_version: 'global-pre-v2.0-2026-02',
        generated_at: '2026-10-14T06:00:00.000Z',
      },
      createdAt: '2026-10-14T06:00:00.000Z',
    },
    sources: {},
    observations: [],
    findings: { total: 1, pending: 1, accepted: 0, edited: 0, rejected: 0 },
    replacement: null,
    history: [],
  }
  const onAccept = vi.fn()
  render(
    <DraftEditor
      section={section}
      position="5 of 13"
      onGenerate={() => {}}
      actions={{ busy: null, onAccept, onEdit: vi.fn(), onReject: vi.fn() }}
      numbers={new Map([['O:o1', 1]])}
      focus={{ citation: null, statement: null }}
      describe={() => 'Site observation'}
      onCite={() => {}}
      figures={(drafted) => <div aria-label="Level I cell">{drafted.get('Level I Scenario')}</div>}
    />,
  )

  const cell = screen.getByLabelText('Level I cell')
  expect(cell).toHaveTextContent('A fire starts in the server room.')
  fireEvent.click(within(cell).getByRole('button', { name: 'Accept finding 1' }))
  expect(onAccept).toHaveBeenCalled()
  // Not listed a second time as its own subsection block.
  expect(screen.getAllByText('A fire starts in the server room.')).toHaveLength(1)
})

it('shows the rail what figures are entered until Section 4 or 5 is drafted', () => {
  const status = (figures: ReviewSection['figures'], state = 'not_drafted') =>
    railStatus({
      completion: { state: 'not_started', written: 0, total: 1, tables: 0 },
      review: { state } as ReviewSection['review'],
      figures,
    } as ReviewSection)
  expect(status({ state: 'none', entered: 0, total: 14 })).toBe('Not started · 0 of 1 subsection')
  expect(status({ state: 'some', entered: 9, total: 14 })).toBe('Figures · 9 of 14 entered')
  expect(status({ state: 'some' })).toBe('Figures partly entered')
  expect(status({ state: 'all', entered: 14, total: 14 })).toBe('Figures entered · ready to draft')
  // Once drafted, the usual written-subsections label is back.
  expect(status({ state: 'all', entered: 14, total: 14 }, 'ai_draft')).toBe(
    'Not started · 0 of 1 subsection',
  )
  // A section without figures (7-12) is unchanged.
  expect(status(null)).toBe('Not started · 0 of 1 subsection')
})
