import { useState } from 'react'
import { SignIn } from './features/auth/SignIn'
import { AssessmentApp } from './features/assessments/AssessmentApp'
import { useAssessmentWorkflow } from './features/assessments/useAssessmentWorkflow'

function Workspace({ onSignOut }: { onSignOut: () => void }) {
  const workflow = useAssessmentWorkflow(onSignOut)
  return <AssessmentApp v={workflow} />
}
export default function App() {
  const [signedIn, setSignedIn] = useState(false)
  return signedIn ? (
    <Workspace onSignOut={() => setSignedIn(false)} />
  ) : (
    <SignIn onSignIn={() => setSignedIn(true)} />
  )
}
