// Settings > Password: change my own password. S-01 AC2.
// Called by Settings.tsx. Calls POST /api/auth/change-password. A good change is a toast;
// field errors and the lockout message stay under the form.
import { useState } from 'react'
import { Button, Icon, Input, toast } from '../../../design-system'
import { GatewayError } from '../../assessments/api'
import { PASSWORD_RULE } from '../../auth/passwordRule'
import { changePassword } from '../api'
import { SettingBlock } from '../components/SettingBlock'

export function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setFields({})
    setProblem('')
    try {
      await changePassword(current, next)
      setCurrent('')
      setNext('')
      toast.success('Password changed')
    } catch (error) {
      if (error instanceof GatewayError) {
        setFields(error.fields)
        // 429 is the lockout after too many wrong tries; show its message under the form.
        if (error.status === 429 || !Object.keys(error.fields).length) setProblem(error.message)
      } else setProblem('Could not change the password.')
    } finally {
      setBusy(false)
    }
  }

  // The form wraps the block, so the block lays out like every other setting.
  return (
    <form onSubmit={submit} noValidate>
      <SettingBlock title="Change password" help={PASSWORD_RULE}>
        <Input
          label="Current password"
          name="current-password"
          type="password"
          autoComplete="current-password"
          value={current}
          error={fields.currentPassword}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          label="New password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          value={next}
          error={fields.newPassword}
          onChange={(e) => setNext(e.target.value)}
        />
        {problem && (
          <p className="st-err" role="alert">
            <Icon name="octagon-alert" size={14} color="var(--red-600)" /> {problem}
          </p>
        )}
        <div className="st-editor st-editor--actions">
          <Button type="submit" variant="primary" pill loading={busy}>
            Change password
          </Button>
        </div>
      </SettingBlock>
    </form>
  )
}
