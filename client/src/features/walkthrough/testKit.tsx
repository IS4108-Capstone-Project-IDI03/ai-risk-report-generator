// A small harness for the engine and bubble tests (F-12, seams 3 and 4).
// Imported only by *.test.tsx files, so none of it reaches the app.
import { useState } from 'react'
import { vi } from 'vitest'
import type { UserRole } from '../accounts/api'
import type { AssessmentWorkflow } from '../assessments/useAssessmentWorkflow'
import { QUIET_WALKTHROUGHS, SESSIONS } from '../../test/session'
import { WalkthroughHost } from './WalkthroughHost'
import type { WalkthroughRecord } from './types'
import { useWalkthroughScreen } from './useWalkthroughScreen'

export const workflow = {
  navOpen: false,
  openNav: vi.fn(),
  closeNav: vi.fn(),
} as unknown as AssessmentWorkflow

/** Returns a screen with every tag the test walkthroughs point at; `tags` leaves some out. */
export function TestScreen({
  name,
  ready = true,
  hold = false,
  admin = false,
}: {
  name: string
  ready?: boolean
  hold?: boolean | 'unsaved'
  admin?: boolean
}) {
  useWalkthroughScreen(name, ready, hold)
  return (
    <main>
      <input data-walk="t.search" aria-label="Search" />
      <button data-walk="t.button">Add</button>
      {admin && <span data-walk="t.admin">Admin</span>}
      <table>
        <tbody>
          <tr data-walk="t.head">
            <th data-walk="t.head-cell">Name</th>
          </tr>
          <tr data-walk="t.row-1">
            <td>Bayfront</td>
          </tr>
        </tbody>
      </table>
    </main>
  )
}

/** Returns the host plus a switchable test screen, signed in as `role` with `record` over a quiet one. */
export function Harness({
  role = 'risk_engineer',
  record = {},
  screen = 'clients',
  hold,
}: {
  role?: UserRole
  record?: Partial<WalkthroughRecord>
  screen?: string
  // The first screen holds offers; 'unsaved' = it has unsaved work.
  hold?: boolean | 'unsaved'
}) {
  const [session] = useState(() => ({
    ...SESSIONS[role],
    walkthroughs: { ...QUIET_WALKTHROUGHS, offers: true, ...record },
  }))
  const [on, setOn] = useState(screen)
  return (
    <>
      <WalkthroughHost session={session} workflow={workflow} />
      <button onClick={() => setOn('other')}>Leave</button>
      <TestScreen key={on} name={on} admin={role === 'knowledge_admin'} hold={hold} />
    </>
  )
}

/** Gives every tagged element a size, so jsdom (which lays nothing out) counts it as visible. */
export function layOut() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    const sized = this.hasAttribute('data-walk')
    return new DOMRect(sized ? 100 : 0, sized ? 100 : 0, sized ? 120 : 0, sized ? 40 : 0)
  })
}
