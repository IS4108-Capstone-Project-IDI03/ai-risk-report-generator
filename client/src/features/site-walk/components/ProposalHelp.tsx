// The (?) beside Create all on a proposal's review (CP-22 round 3, moved onto the shared help tip
// in F-13): how a review works, in three steps, behind one tap. Called by ProposalHeader.tsx.
// Calls Tip (features/help).
import { Tip } from '../../help/Tip'

/** Returns the proposal review's help (?). */
export function ProposalHelp() {
  return (
    <Tip id="site-walk.proposal" align="right">
      <ol>
        <li>Go through each location. A red mark shows what an observation still needs.</li>
        <li>Change, add or delete locations and observations. Every edit saves as you go.</li>
        <li>Press Create all to add everything to the assessment. Until then, none of it is.</li>
      </ol>
    </Tip>
  )
}
