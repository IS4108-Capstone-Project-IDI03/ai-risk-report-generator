// The Assigned engineer field on the New Assessment form (RV-11 AC1, AC4-AC6):
// shown to admins only, Me first, each person with a role word, required.
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Toaster } from '../../design-system'
import type { Person } from '../assignment/api'
import { EngineerPicker } from '../assignment/components/EngineerPicker'
import { NewAssessment } from './screens/NewAssessment'
import { blankForm, formFromResult, toBody } from './form'
import { calls, created, gateway, json, sent } from './testKit'

const SANA = '6ab39017e45cf009e4507734'
const ALEX = '6ab39017e45cf009e4507731'
const OMAR = '6ab39017e45cf009e4507735'
const PEOPLE = {
  items: [
    { id: ALEX, name: 'Alex Rowe', role: 'risk_engineer' },
    { id: OMAR, name: 'Omar Khan', role: 'knowledge_admin' },
    { id: SANA, name: 'Sana Patel', role: 'knowledge_admin' },
  ],
}
const ME = { id: SANA, name: 'Sana Patel' }

const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } })
const site = (n: number) => screen.getByRole('region', { name: 'Site ' + n })
const visit = (s: HTMLElement, n: number) =>
  within(within(s).getByRole('region', { name: 'Assessment ' + n }))
const picker = (n = 1) => visit(site(1), n).getByRole('button', { name: /^Assigned engineer/ })

function open(assign: typeof ME | undefined, onCreated = vi.fn()) {
  render(
    <>
      <NewAssessment
        mode="form"
        start={{}}
        assign={assign}
        onCreated={onCreated}
        onLeave={vi.fn()}
      />
      <Toaster />
    </>,
  )
  return onCreated
}
function fillNewClient() {
  type(screen.getByLabelText(/^Client name/), 'Pacific Crest REIT')
  type(within(site(1)).getByLabelText(/^Site name/), 'Tuas Hub')
  type(within(site(1)).getByLabelText(/^Facility type/), 'Distribution warehouse')
  type(within(site(1)).getByLabelText(/^Address/), '21 Tuas South Ave 3')
}
const routes = (extra = {}) => ({
  'GET /api/clients': () => json(200, []),
  'GET /api/assessments/assignable-engineers': () => json(200, PEOPLE),
  ...extra,
})

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})

describe('Assigned engineer (RV-11)', () => {
  it('lists Me first, then everyone else by name, each with its role in words (AC4)', async () => {
    gateway(routes())
    open(ME)
    fireEvent.click(await screen.findByRole('button', { name: /^Assigned engineer.*Me/ }))

    const options = screen.getAllByRole('menuitemradio')
    // Each row reads: initials, name, role word.
    expect(options.map((o) => o.textContent)).toEqual([
      'SPMeAdmin',
      'ARAlex RoweEngineer',
      'OKOmar KhanAdmin',
    ])
    // Me carries the caller's initials; the caller is not listed a second time.
    expect(within(options[0]).getByText('SP')).toBeInTheDocument()
    expect(within(options[1]).getByText('AR')).toBeInTheDocument()
    expect(screen.queryByText('Sana Patel')).not.toBeInTheDocument()
  })

  it('is a required field that starts on Me (AC4)', async () => {
    gateway(routes())
    open(ME)
    const trigger = await screen.findByRole('button', { name: /^Assigned engineer/ })
    expect(trigger).toHaveTextContent('Me')
    expect(within(visit(site(1), 1).getByText(/^Assigned engineer/)).getByText('*')).toBeVisible()
  })

  it('shows the chosen person’s role in the field, inside the name a screen reader hears', async () => {
    gateway(routes())
    open(ME)
    const trigger = await screen.findByRole('button', { name: /^Assigned engineer/ })
    expect(within(trigger).getByText('Admin')).toBeVisible()
    expect(trigger).toHaveAccessibleName('Assigned engineer Me Admin')
  })

  it('shows no role while nobody is chosen', () => {
    const people = PEOPLE.items as Person[]
    render(<EngineerPicker people={people} me={ME} value="" onChange={vi.fn()} />)
    const trigger = screen.getByRole('button', { name: /^Assigned engineer/ })
    expect(trigger).toHaveTextContent('Choose')
    expect(trigger).not.toHaveTextContent(/Admin|Engineer$/)
  })

  it('sends the chosen engineer for each assessment, and a new block copies the one before', async () => {
    gateway(
      routes({
        'POST /api/assessments': () =>
          json(201, { clientId: 'c9', assessments: [created('R1'), created('R2')] }),
      }),
    )
    const onCreated = open(ME)
    await screen.findByRole('button', { name: /^Assigned engineer/ })
    fillNewClient()

    fireEvent.click(picker())
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Alex Rowe/ }))
    expect(picker()).toHaveTextContent('Alex Rowe')

    fireEvent.click(within(site(1)).getByRole('button', { name: 'Add assessment' }))
    // The new block starts on the engineer of the one before it.
    expect(picker(2)).toHaveTextContent('Alex Rowe')
    fireEvent.click(visit(site(1), 2).getByRole('radio', { name: 'Follow-up' }))
    fireEvent.click(picker(2))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Me/ }))

    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled())
    const [post] = sent('POST', '/api/assessments')
    expect(post.body).toMatchObject({
      sites: [{ assessments: [{ engineerId: ALEX }, { engineerId: SANA }] }],
    })
  })

  it('sends Me when I leave it alone', async () => {
    gateway(
      routes({
        'POST /api/assessments': () => json(201, { clientId: 'c9', assessments: [created('R1')] }),
      }),
    )
    const onCreated = open(ME)
    await screen.findByRole('button', { name: /^Assigned engineer/ })
    fillNewClient()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(sent('POST', '/api/assessments')[0].body).toMatchObject({
      sites: [{ assessments: [{ engineerId: SANA }] }],
    })
  })

  it('shows the gateway’s refusal of an engineer under the field', async () => {
    gateway(
      routes({
        'POST /api/assessments': () =>
          json(400, {
            error: 'Choose an active account.',
            fields: { 'sites.0.assessments.0.engineerId': 'Choose an active account.' },
          }),
      }),
    )
    open(ME)
    await screen.findByRole('button', { name: /^Assigned engineer/ })
    fillNewClient()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    expect(await screen.findByText('Choose an active account.')).toBeInTheDocument()
    expect(picker()).toHaveAttribute('aria-invalid', 'true')
  })

  it('says so at the field when the list cannot load, and still sends Me explicitly', async () => {
    gateway(
      routes({
        'GET /api/assessments/assignable-engineers': () => json(500, { error: 'Down' }),
        'POST /api/assessments': () => json(201, { clientId: 'c9', assessments: [created('R1')] }),
      }),
    )
    const onCreated = open(ME)
    expect(await screen.findByText(/Couldn.t load the other accounts/)).toBeInTheDocument()
    fillNewClient()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(sent('POST', '/api/assessments')[0].body).toMatchObject({
      sites: [{ assessments: [{ engineerId: SANA }] }],
    })
  })

  it('gives an engineer no field, asks for no list and sends no engineer (AC1)', async () => {
    gateway(
      routes({
        'POST /api/assessments': () => json(201, { clientId: 'c9', assessments: [created('R1')] }),
      }),
    )
    const onCreated = open(undefined)
    expect(screen.queryByText(/Assigned engineer/)).not.toBeInTheDocument()
    fillNewClient()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await vi.waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(sent('POST', '/api/assessments')[0].body).not.toHaveProperty(
      'sites.0.assessments.0.engineerId',
    )
    expect(calls.some((c) => c.url.includes('assignable-engineers'))).toBe(false)
  })

  it('carries the choice into an assessment read from documents', () => {
    const read = formFromResult(
      {
        client: {
          name: { value: 'Pacific Crest REIT', source: null },
          division: { value: null, source: null },
          existingId: null,
          matchNotSure: false,
        },
        sites: [
          {
            ref: 's1',
            existingId: null,
            matchNotSure: false,
            name: { value: 'Tuas Hub', source: null },
            address: { value: 'Tuas', source: null },
            jurisdiction: { value: 'SG', source: null },
            facilityType: { value: 'Cold store', source: null },
          },
        ],
        assessments: [
          {
            ref: 'a1',
            siteRef: 's1',
            visitType: { value: 'First survey', source: null },
            siteVisitDate: { value: '2026-11-12', source: null },
            siteVisitEndDate: { value: null, source: null },
            reportDueDate: { value: null, source: null },
            siteContacts: [],
          },
        ],
        documents: [],
      },
      {},
    )
    const body = toBody(read, undefined, SANA)
    expect(body.sites[0].assessments[0]).toMatchObject({ engineerId: SANA })
    expect(toBody(blankForm()).sites[0].assessments[0]).not.toHaveProperty('engineerId')
  })
})
