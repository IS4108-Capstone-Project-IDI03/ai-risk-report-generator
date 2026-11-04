// One site's card in the New Assessment form (CP-23, boards 08, 12): pin
// tile, its name (New badge for a site not yet recorded) and Remove site;
// a new site's Site name | Jurisdiction | Facility type, then
// Address; then each assessment and "Add assessment". Used by
// screens/NewAssessmentForm.tsx.
import { useState } from 'react'
import { AddRow, Icon, IconButton, NewBadge, toast } from '../../../design-system'
import { plural } from '../../clients/formatClient'
import { FACILITY_TYPES, JURISDICTIONS } from '../../assessments/demo-data'
import {
  copyAt,
  docsOn,
  firstSurveyOnly,
  isNewSite,
  siteLabel,
  typeOf,
  type FormSite,
} from '../form'
import type { NewAssessmentForm } from '../useNewAssessment'
import { Block, useExit } from './Block'
import { AssessmentBlock } from './AssessmentBlock'
import { SelectField, TextField } from './Field'
import { RemoveSiteDialog } from './RemoveSiteDialog'
import { Suggestion } from './Suggestion'

export function SiteCard({ f, i, site }: { f: NewAssessmentForm; i: number; site: FormSite }) {
  const { form } = f
  const path = `sites.${i}.`
  const isNew = isNewSite(form, site)
  const existing = form.clientMode === 'existing'
  const listed = f.sitesOf?.find((x) => x.id === site.choice)
  const notSure = (k: string) => site.notSure.includes(k)
  // A new client's sites are numbered; a recorded client's are named.
  const title = existing ? site.name.trim() || listed?.name || 'New site' : 'Site ' + (i + 1)
  // A site with anything in it asks first; an empty one goes at once.
  const [asking, setAsking] = useState(false)
  const exit = useExit()
  const placed = docsOn(form, site)
  const filled = !!(site.name.trim() || site.address.trim() || placed)
  const copy = copyAt(form, site, f.sitesOf)
  return (
    <section className="na-card" aria-label={'Site ' + (i + 1)}>
      <div className="na-card-head">
        <span className="na-tile">
          <Icon name="map-pin" size={16} />
        </span>
        <h2 dir="auto">{title}</h2>
        {existing && isNew && <NewBadge />}
        <span className="na-card-actions">
          {form.sites.length > 1 && (
            <IconButton
              icon="trash-2"
              label={'Remove site ' + (i + 1)}
              onClick={() => (filled ? setAsking(true) : exit(() => f.removeSite(i)))}
            />
          )}
        </span>
      </div>
      {isNew && (
        <div className="na-site-fields">
          <div className="na-site-row">
            <div>
              <TextField
                label="Site name"
                required
                placeholder="e.g. Tuas Cold Store"
                value={site.name}
                notSure={notSure('name')}
                error={f.errors[path + 'name']}
                onChange={(e) => f.setSite(i, { name: e.target.value })}
              />
              <Suggestion name={f.siteSuggestion(site)} onUse={(n) => f.useSiteName(i, n)} />
            </div>
            <SelectField
              label="Jurisdiction"
              required
              options={JURISDICTIONS}
              value={site.jurisdiction}
              notSure={notSure('jurisdiction')}
              error={f.errors[path + 'jurisdiction']}
              onChange={(e) => f.setSite(i, { jurisdiction: e.target.value })}
            />
            <SelectField
              label="Facility type"
              required
              options={FACILITY_TYPES}
              value={site.facilityType}
              notSure={notSure('facilityType')}
              error={f.errors[path + 'facilityType']}
              onChange={(e) => f.setSite(i, { facilityType: e.target.value })}
            />
          </div>
          <TextField
            label="Address"
            required
            iconLeft="map-pin"
            placeholder="Street and postcode"
            value={site.address}
            notSure={notSure('address')}
            error={f.errors[path + 'address']}
            onChange={(e) => f.setSite(i, { address: e.target.value })}
          />
        </div>
      )}
      {site.assessments.map((a, j) => (
        <Block key={a.ref}>
          <AssessmentBlock
            f={f}
            i={i}
            j={j}
            a={a}
            type={typeOf(form, site, j, f.sitesOf)}
            firstOnly={firstSurveyOnly(form, site, j, f.sitesOf)}
            removable={site.assessments.length > 1}
            copy={
              copy === j && listed?.latest
                ? {
                    count: listed.latest.locations,
                    // The report and its survey date, as the approved round 13 board shows.
                    from:
                      listed.latest.reference +
                      (listed.latest.siteVisitDate
                        ? ' · ' + listed.latest.siteVisitDate.split('-').reverse().join('/')
                        : ''),
                    on: site.copyLocations,
                    set: (copyLocations) => f.setSite(i, { copyLocations }),
                  }
                : null
            }
          />
        </Block>
      ))}
      <AddRow onClick={() => f.addAssessment(i)}>{'Add assessment'}</AddRow>
      {asking && (
        <RemoveSiteDialog
          name={siteLabel(form, i, f.sitesOf)}
          documents={placed}
          onRemove={() => {
            setAsking(false)
            exit(() => f.removeSite(i))
            // A confirmed removal gets a toast, like every other confirmed action (round 15).
            toast.success(
              siteLabel(form, i, f.sitesOf) + ' removed',
              placed
                ? { description: `${plural(placed, 'document')} moved to Whole client.` }
                : undefined,
            )
          }}
          onClose={() => setAsking(false)}
        />
      )}
    </section>
  )
}
