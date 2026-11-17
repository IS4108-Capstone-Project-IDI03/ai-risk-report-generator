// A section that is not built yet: "Coming soon", no controls. S-01 AC12, AC16.
// Called by Settings.tsx for Checklist, Source priority, Note-taking and QA criteria.
export function ComingSoonSection({ name }: { name: string }) {
  return (
    <div className="st-soon">
      <strong>{name}</strong>
      <p className="st-note">Coming soon</p>
    </div>
  )
}
