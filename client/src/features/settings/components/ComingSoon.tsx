// A "Coming soon" tile that names who is building it. S-01 AC16.
// Used by screens/ComingSoonSection and screens/QaSection.
export function ComingSoon({ name, owner }: { name: string; owner: string }) {
  return (
    <div className="st-soon">
      <strong>{name}</strong>
      <p className="st-note">Coming soon. Being built by {owner}.</p>
    </div>
  )
}
