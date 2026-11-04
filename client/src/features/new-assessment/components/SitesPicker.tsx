// The Sites card of a recorded client (CP-23, boards 09, 12): the client's
// recorded sites and the new ones on this form as checkbox cards, then
// "+ New site". Used by screens/NewAssessmentForm.tsx.
import { useState } from 'react'
import { AddRow, Icon } from '../../../design-system'
import { day } from '../../clients/formatClient'
import { docsOn, isNewSite, NEW_SITE } from '../form'
import type { NewAssessmentForm } from '../useNewAssessment'
import { ErrorLine } from './Field'
import { RemoveSiteDialog } from './RemoveSiteDialog'
import { SitePickCard, type SitePick } from './SitePickCard'

/** Returns "Last: RPT-… · 11 Apr 2026" for a site's latest assessment. */
const lastText = (reference: string, date: string | null) =>
  'Last: ' + reference + (date ? ' · ' + day(date.slice(0, 10)) : '')

export function SitesPicker({ f }: { f: NewAssessmentForm }) {
  const { form } = f
  // A new site with anything typed asks before it goes; an empty one goes at once.
  const [asking, setAsking] = useState<number | null>(null)
  const status = (id: string) =>
    f.clientPage?.sites?.find((s) => s.id === id)?.visits[0]?.status ?? null
  const recorded: (SitePick & { id: string })[] = (f.sitesOf ?? []).map((s) => ({
    key: s.id,
    id: s.id,
    name: s.name,
    isNew: false,
    jurisdiction: s.jurisdiction,
    facilityType: s.facilityType,
    address: s.address ?? '',
    last: s.latest ? lastText(s.latest.reference, s.latest.siteVisitDate) : null,
    status: s.latest ? status(s.id) : null,
  }))
  const added = form.sites.flatMap((s, i) =>
    isNewSite(form, s) && s.choice === NEW_SITE
      ? [
          {
            i,
            pick: {
              key: s.ref,
              name: s.name.trim() || 'New site',
              isNew: true,
              jurisdiction: s.jurisdiction,
              facilityType: s.facilityType,
              address: s.address.trim(),
              last: null,
              status: null,
            },
          },
        ]
      : [],
  )
  const chosen = form.sites.length
  const error = f.errors['sites']
  return (
    <section className="na-card" aria-label="Sites">
      <div className="na-card-head">
        <span className="na-tile">
          <Icon name="map" size={16} />
        </span>
        <h2>{'Sites'}</h2>
        {chosen > 0 && <span className="na-count">{chosen}</span>}
      </div>
      {f.sitesLoading ? (
        <p role="status" className="na-muted">
          {'Loading the client’s sites…'}
        </p>
      ) : (
        <div className="na-picks" data-error={error ? '' : undefined}>
          {recorded.map((s) => (
            <SitePickCard
              key={s.key}
              site={s}
              checked={form.sites.some((x) => x.choice === s.id)}
              onToggle={() => f.toggleSite(s.id)}
            />
          ))}
          {added.map(({ i, pick }) => (
            <SitePickCard
              key={pick.key}
              site={pick}
              checked
              onToggle={() =>
                form.sites[i].name.trim() || form.sites[i].address.trim()
                  ? setAsking(i)
                  : f.removeSite(i)
              }
            />
          ))}
        </div>
      )}
      {error && <ErrorLine text={error} />}
      <AddRow onClick={f.addSite}>{'New site'}</AddRow>
      {asking !== null && (
        <RemoveSiteDialog
          name={form.sites[asking]?.name.trim() || 'this site'}
          documents={docsOn(form, form.sites[asking])}
          onRemove={() => {
            f.removeSite(asking)
            setAsking(null)
          }}
          onClose={() => setAsking(null)}
        />
      )}
    </section>
  )
}
