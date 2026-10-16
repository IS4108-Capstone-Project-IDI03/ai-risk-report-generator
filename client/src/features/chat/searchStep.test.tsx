// Tests for the search step shown above an answer (CB-01 AC6, AC8).
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { SearchStep } from './components/SearchStep'

afterEach(cleanup)

// One search step as OpenUI hands it over; the result arrives as JSON text.
const search = (status: string, input: object, result?: object) =>
  ({
    id: 's',
    toolName: 'search_knowledge_base',
    status,
    input,
    result: result && JSON.stringify(result),
  }) as never

describe('Search step', () => {
  it('says the knowledge base is being searched while it runs (AC8)', () => {
    render(<SearchStep activities={[search('executing', { query: 'q', filters: {} })]} />)
    // Announced to screen readers as it changes (AC8).
    expect(screen.getByRole('status')).toHaveTextContent('Searching the knowledge base…')
  })

  it('names the filters it searched with once done (AC6)', () => {
    const filters = { jurisdiction: 'SG', facility_type: 'Office', source_type: 'marsh_report' }
    render(<SearchStep activities={[search('complete', { query: 'q', filters }, { filters })]} />)
    expect(screen.getByText('Searched: Singapore · Office · Past reports')).toBeInTheDocument()
  })

  it('names a local standards filter and a document the question named', () => {
    const filters = { source_type: 'local_standard', document: 'CP 52 (2004)' }
    render(<SearchStep activities={[search('complete', { query: 'q', filters }, { filters })]} />)
    expect(screen.getByText('Searched: Local standards · CP 52 (2004)')).toBeInTheDocument()
  })

  it('lists the steps it took behind the summary line', () => {
    render(
      <SearchStep
        activities={[
          search(
            'complete',
            { query: 'dry pendent test interval', filters: {}, also: ['NFPA 25 dry sprinklers'] },
            { filters: {}, passages: 5, declined: false },
          ),
        ]}
      />,
    )
    const steps = screen.getByRole('list', { hidden: true })
    expect(steps).toHaveTextContent('Searched for “dry pendent test interval”')
    expect(steps).toHaveTextContent('Also searched for “NFPA 25 dry sprinklers”')
    expect(steps).toHaveTextContent('Found 5 relevant passages')
  })

  it('says it searched everything when no filter was named', () => {
    render(
      <SearchStep
        activities={[search('complete', { query: 'q', filters: {} }, { filters: {} })]}
      />,
    )
    expect(screen.getByText('Searched the whole knowledge base')).toBeInTheDocument()
  })
})
