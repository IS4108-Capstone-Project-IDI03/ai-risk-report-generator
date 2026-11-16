// Dialog (AS-06 round 9): its close button is 44 x 44 on a phone and the usual size elsewhere, set
// by the Dialog itself rather than by an !important rule in the stylesheet.
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const phone = (yes: boolean) =>
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: yes && query.includes('max-width: 767px'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))

describe('Dialog close button', () => {
  it('is 44 x 44 on a phone, with or without a title', () => {
    phone(true)
    render(<Dialog title="Edit" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveStyle({
      width: '44px',
      height: '44px',
    })
    cleanup()
    render(<Dialog ariaLabel="Plain" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveStyle({
      width: '44px',
      height: '44px',
    })
  })

  it('keeps the small icon-button size above 768 px', () => {
    phone(false)
    render(<Dialog title="Edit" onClose={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveStyle({
      width: 'var(--control-height-sm)',
    })
  })
})
