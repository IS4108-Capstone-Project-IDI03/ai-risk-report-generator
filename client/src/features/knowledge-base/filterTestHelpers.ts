// Test helpers for the Documents list's filter pills (FilterMenu): open a pill and choose an
// option by its words, and read which option a pill shows. Used by the knowledge-base tests.
import { fireEvent, screen, within } from '@testing-library/react'

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
