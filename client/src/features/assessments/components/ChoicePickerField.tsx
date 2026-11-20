// A picker field (design system) whose list is our ChoiceMenu (CP-24): a category, severity or
// location field with its icon, the usual list, and the not-sure marks with Confirm and Change.
// Called by the observation page and New Observation. Calls PickerField, ChoiceMenu.
import type { ReactNode } from 'react'
import { PickerField, type PickerFieldProps } from '../../../design-system'
import { ChoiceMenu, type Choice } from './ChoiceMenu'

export type ChoicePickerFieldProps = Omit<PickerFieldProps, 'list'> & {
  choices: Choice[]
  selected: string[]
  onChoose: (value: string) => void
  // A choice that stays open so several can be ticked (categories).
  multiple?: boolean
  hint?: ReactNode
}

/** Returns the field; Change opens the same list the field does. */
export function ChoicePickerField({
  choices,
  selected,
  onChoose,
  multiple,
  hint,
  ...field
}: ChoicePickerFieldProps) {
  return (
    <PickerField
      {...field}
      list={({ className, trigger }) => (
        <ChoiceMenu
          label={field.label}
          choices={choices}
          selected={selected}
          onChoose={onChoose}
          multiple={multiple}
          hint={hint}
          className={className}
          trigger={trigger}
        />
      )}
    />
  )
}
