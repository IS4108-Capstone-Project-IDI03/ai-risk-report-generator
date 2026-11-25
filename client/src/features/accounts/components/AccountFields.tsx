// The account fields shared by adding (F-08) and editing (F-03) an account. Each shows the
// gateway's problem with it, if any. Called by screens/AccountProfile.tsx and screens/NewAccount.tsx.
import { Input, Select } from '../../../design-system'
import type { UserProfile, UserRole } from '../api'
import { OFFICE_OPTIONS, ROLE_OPTIONS } from '../accountFormat'

export type AccountFieldValues = Pick<
  UserProfile,
  'name' | 'email' | 'jobTitle' | 'phone' | 'office'
> & {
  role: UserRole | ''
}

export function AccountFields({
  values,
  errors,
  onChange,
  roleOptions = ROLE_OPTIONS,
  roleLocked = false,
}: {
  values: AccountFieldValues
  errors: Record<string, string>
  onChange: (key: keyof AccountFieldValues, value: string) => void
  roleOptions?: { value: string; label: string }[]
  roleLocked?: boolean
}) {
  return (
    <div className="accounts-form">
      <Input
        label="Name"
        required
        value={values.name}
        error={errors.name}
        autoComplete="off"
        onChange={(e) => onChange('name', e.target.value)}
      />
      <Input
        label="Email"
        type="email"
        required
        value={values.email}
        error={errors.email}
        autoComplete="off"
        onChange={(e) => onChange('email', e.target.value)}
      />
      <Select
        label="Role"
        required
        options={roleOptions}
        value={values.role}
        error={errors.role}
        disabled={roleLocked}
        hint={roleLocked ? 'Another knowledge admin must change your role.' : undefined}
        onChange={(e) => onChange('role', e.target.value)}
      />
      <Input
        label="Job title"
        value={values.jobTitle}
        error={errors.jobTitle}
        placeholder="Optional"
        onChange={(e) => onChange('jobTitle', e.target.value)}
      />
      <Input
        label="Phone"
        type="tel"
        placeholder="Optional, e.g. +65 6123 4567"
        value={values.phone}
        error={errors.phone}
        onChange={(e) => onChange('phone', e.target.value)}
      />
      <Select
        label="Office"
        options={OFFICE_OPTIONS}
        value={values.office}
        error={errors.office}
        onChange={(e) => onChange('office', e.target.value)}
      />
    </div>
  )
}
