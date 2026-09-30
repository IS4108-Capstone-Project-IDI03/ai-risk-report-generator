import { Button, EmptyState } from '../../design-system'

// What the route guard (F-05) shows in place of a screen the signed-in role
// may not open, e.g. one reached by typing or following its URL.
export function AccessDenied({ roleLabel, onLeave }: { roleLabel: string; onLeave: () => void }) {
  return (
    <div role="alert">
      <EmptyState
        icon="lock"
        title="You do not have access to this page"
        description={`Your role, ${roleLabel}, does not include it. Ask a knowledge admin if you need access.`}
        action={
          <Button variant="primary" onClick={onLeave}>
            Go to your workspace
          </Button>
        }
      />
    </div>
  )
}
