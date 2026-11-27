// Test helpers for the Documents list's filter pills (FilterMenu): open a pill and choose an
// option by its words, and read which option a pill shows. Also the forms' dropdown fields
// (the design system's Select): choose an option, and read which one shows. Used by the
// knowledge-base tests.
import { fireEvent, screen, within } from '@testing-library/react'
import { chooseOption, selectField } from '../../design-system/components/forms/selectTestHelpers'

/** Opens the pill named `name` and chooses the option with `option` as its words. */
export function choose(name: string, option: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}(:|$)`) }))
  const menu = screen.getByRole('listbox', { name })
  fireEvent.click(within(menu).getByRole('option', { name: option }))
}

/** Returns the pill named `name`, whose accessible name carries the chosen option. */
export const pill = (name: string) =>
  screen.getByRole('button', { name: new RegExp(`^${name}(:|$)`) })

/** Types into the Search titles field. */
export const search = (value: string) =>
  fireEvent.change(screen.getByLabelText('Search titles'), { target: { value } })

/** Returns the dropdown field labelled `label` in `scope` (the design system's Select). */
export const field = (scope: HTMLElement, label: string) => selectField(label, scope)

/** Opens the dropdown field labelled `label` in `scope` and chooses the option `option`. */
export const pick = (scope: HTMLElement, label: string, option: string) =>
  chooseOption(label, option, scope)

/** Returns the words a dropdown field shows: its option, or its placeholder. */
export const shown = (scope: HTMLElement, label: string) => field(scope, label).textContent
