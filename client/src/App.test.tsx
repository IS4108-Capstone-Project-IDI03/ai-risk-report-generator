import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

beforeAll(() => {
  // jsdom has no native modal implementation; browser supplies focus trapping.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
beforeEach(() => {
  // The capture screen calls the gateway; these demo tests run without one.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
  )
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function signIn() {
  fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
  fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'sample-password' } })
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
}
function openAssessment() {
  fireEvent.click(screen.getByRole('button', { name: 'Tilbury Distribution Centre' }))
}
function tab(name: RegExp) {
  fireEvent.click(screen.getByRole('tab', { name }))
}

describe('Marsh prototype integration', () => {
  it('starts at sign-in, validates, enters the dashboard, and resets on sign-out', () => {
    const view = render(<App />)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Complete the required fields')
    signIn()
    expect(screen.getByRole('heading', { name: 'Your assessments' })).toBeInTheDocument()
    expect(screen.getAllByPlaceholderText('Search site, client or report ID')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    signIn()
    view.unmount()
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
  it('keeps SSO, reset, and access requests explicitly simulated', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /single sign-on/ }))
    expect(screen.getByRole('status')).toHaveTextContent('not connected')
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    expect(screen.getByRole('status')).toHaveTextContent('No email was sent')
    tab(/Request access/)
    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: 'Demo Engineer' } })
    fireEvent.change(screen.getByLabelText(/Work email/), { target: { value: 'demo@marsh.com' } })
    fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'DemoPassword1!' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Request access' }))
    expect(screen.getByRole('status')).toHaveTextContent('No request was sent')
  })
  it('filters the dashboard and creates an in-memory assessment', async () => {
    render(<App />)
    signIn()
    fireEvent.change(screen.getByPlaceholderText('Search site, client or report ID'), {
      target: { value: 'does-not-exist' },
    })
    expect(screen.getByText(/0 of 4 assessments/)).toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('Search site, client or report ID'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'New assessment' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Create assessment' }))
    expect(screen.getByText('Site name is required')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Site name/), { target: { value: 'Demo Warehouse' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^Client/ }), {
      target: { value: 'Demo Client' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create assessment' }))
    expect(await screen.findByRole('heading', { name: 'Your assessments' })).toBeInTheDocument()
    expect(screen.getByText('Demo Warehouse')).toBeInTheDocument()
    expect(screen.getByText(/exists only in this demo and is not saved/)).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'New assessment' })[0])
    fireEvent.change(screen.getByLabelText(/Site name/), { target: { value: 'Second Warehouse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create assessment' }))
    expect(await screen.findByText('Second Warehouse')).toBeInTheDocument()
    expect(screen.getByText('Demo Warehouse')).toBeInTheDocument()
    expect(screen.getByText('6 of 6 assessments')).toBeInTheDocument()
  })
  it('saves observations and displays them in the assessment', () => {
    render(<App />)
    signIn()
    fireEvent.click(screen.getAllByRole('button', { name: /^Site observation/ })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))
    expect(screen.getByText('Add a note, recording or photograph first.')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: /Observation/ }), {
      target: { value: 'Demo sprinkler observation' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save observation' }))
    openAssessment()
    tab(/Observations/)
    expect(screen.getByText('Demo sprinkler observation')).toBeInTheDocument()
  })
  it('stops and resumes simulated generation', () => {
    vi.useFakeTimers()
    render(<App />)
    signIn()
    openAssessment()
    tab(/Report generation/)
    fireEvent.click(screen.getByRole('button', { name: 'Stop generation' }))
    const dialog = screen.getByRole('dialog', { name: 'Stop generation?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Stop generation' }))
    expect(screen.getByRole('button', { name: 'Resume generation' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resume generation' }))
    act(() => vi.advanceTimersByTime(15000))
    expect(screen.getByText(/5 of 7 sections drafted · 2 need attention/)).toBeInTheDocument()
  })
  it('requires review and evidence resolution before simulating export', () => {
    render(<App />)
    signIn()
    openAssessment()
    tab(/Validation and export/)
    expect(screen.getByRole('button', { name: 'Export as DOCX' })).toBeDisabled()
    tab(/^Review/)
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(screen.getByRole('status')).toHaveTextContent('Resolve the open review item')
    fireEvent.click(screen.getByRole('button', { name: 'Remove the sentence' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not available — record as a finding' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Engineer-reviewed water supply finding.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }))
    expect(screen.getByText('Engineer-reviewed water supply finding.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Use 8 weeks — 2023 report' }))
    expect(screen.getByText('Source chosen — 2023 report')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    tab(/Validation and export/)
    expect(screen.getByRole('button', { name: 'Export as DOCX' })).toBeEnabled()
    fireEvent.click(screen.getByRole('radio', { name: /PDF/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Export as PDF' }))
    fireEvent.click(screen.getByRole('button', { name: 'Simulate export' }))
    expect(screen.getByRole('status')).toHaveTextContent('No file was generated or issued')
  })
  it.each([390, 900])('provides usable navigation at %ipx', (width) => {
    const previous = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    render(<App />)
    signIn()
    if (width < 760) {
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
      const drawer = screen.getByRole('dialog', { name: 'Navigation' })
      expect(within(drawer).queryByRole('heading', { name: 'Navigation' })).not.toBeInTheDocument()
      fireEvent.click(within(drawer).getByRole('button', { name: 'Close' }))
      expect(screen.queryByRole('dialog', { name: 'Navigation' })).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }))
    }
    openAssessment()
    expect(screen.getByRole('heading', { name: 'Tilbury Distribution Centre' })).toBeInTheDocument()
    tab(/^Review/)
    expect(screen.getByRole('button', { name: 'Remove the sentence' })).toBeInTheDocument()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: previous })
  })
})
