// What an assessment's workspace shows instead of its tabs while it is not on the work list:
// grey rows while the list loads, the error with Try again when it can't be read, or that the
// assessment isn't on the engineer's list. Rendered by AssessmentApp from v.workspaceGate.
import { Button, EmptyState } from '../../../design-system'
import type { AssessmentWorkflow } from '../useAssessmentWorkflow'
import { WorkSkeleton } from './WorkSkeleton'
import '../assessment-list.css'

export function WorkspaceState({ v }: { v: AssessmentWorkflow }) {
  const gate = v.workspaceGate
  return (
    <div style={{ padding: '24px clamp(16px, 4vw, var(--page-gutter)) 40px' }}>
      {gate === 'loading' && (
        <div className="at-card">
          <WorkSkeleton label="Loading assessment" />
        </div>
      )}
      {gate === 'failed' && (
        <div role="alert">
          <EmptyState
            icon="cloud-off"
            title="Can’t load this assessment"
            description="Check your connection, then try again."
            action={
              <Button variant="secondary" pill iconLeft="refresh-cw" onClick={v.retryList}>
                {'Try again'}
              </Button>
            }
          />
        </div>
      )}
      {gate === 'missing' && (
        <EmptyState
          icon="search-x"
          title="This assessment isn’t on your list"
          description="It may have moved to another engineer, or the link may be wrong."
          action={
            <Button variant="primary" pill iconLeft="arrow-left" onClick={v.leaveMissing}>
              {'Back to assessments'}
            </Button>
          }
        />
      )}
    </div>
  )
}
