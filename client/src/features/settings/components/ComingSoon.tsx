// The quiet line for a section another teammate is still building, naming who. S-01 AC16.
// Used by screens/ComingSoonSection. The section's own title above it already names the section.
export function ComingSoon({ owner }: { owner: string }) {
  return <p className="st-note">Coming soon. Being built by {owner}.</p>
}
