// The practice email the "Start from the client's documents" walkthrough uses (F-12): a made-up
// client's request for a first survey, which ships with the app. Called by components/UploadArea.tsx.
// It leaves the division, site name and facility type unclear on purpose, so amber fields show.
import sample from './sample/practice-email.eml?raw'

/** Returns the sample email as a File, which goes down the same upload path as a real one. */
export function sampleEmail(): File {
  return new File([sample], 'practice-email.eml', { type: 'message/rfc822' })
}
