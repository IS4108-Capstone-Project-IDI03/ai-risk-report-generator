// A section that is not built yet: "Coming soon" with the owner's name, no controls. S-01 AC16.
// Called by Settings.tsx for QA eval and Checklist.
import { ComingSoon } from '../components/ComingSoon'

export function ComingSoonSection({ owner }: { owner: string }) {
  return <ComingSoon owner={owner} />
}
