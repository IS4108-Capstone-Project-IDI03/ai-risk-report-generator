// A section that is not built yet: "Coming soon" with the owner's name, no controls. S-01 AC16.
// Called by Settings.tsx for Checklist, Source priority and Note-taking.
import { ComingSoon } from '../components/ComingSoon'

export function ComingSoonSection({ name, owner }: { name: string; owner: string }) {
  return <ComingSoon name={name} owner={owner} />
}
