// The New Assessment form's state (CP-23): a new or recorded client, the
// sites and assessments being typed or filled in from documents, the
// documents and their tags, and Create. Called by screens/NewAssessment.tsx.
// Calls api.ts, assessments/api.ts (clients, sites) and clients/api.ts (the
// client page's statuses, and keeping hand-added documents).
import { useEffect, useState } from 'react'
import { toast } from '../../design-system'
import {
  GatewayError,
  listClients,
  listClientSites,
  type Assessment,
  type Client,
  type ClientSite,
} from '../assessments/api'
import { similarName } from '../assessments/locations'
import {
  getClientPage,
  retagClientDocument,
  uploadClientDocuments,
  type ClientPage,
  type UploadedFile,
} from '../clients/api'
import { createAssessments, createFromIntake, type Placement } from './api'
import {
  blankAssessment,
  blankForm,
  blankSite,
  keptPlacement,
  NEW_SITE,
  toBody,
  type ClientMode,
  type Contact,
  type Form,
  type FormAssessment,
  type FormDocument,
  type FormSite,
} from './form'
import { validate } from './validate'

export type CreateStart = { clientId?: string; clientName?: string; siteId?: string }
export type NewAssessmentForm = ReturnType<typeof useNewAssessment>

// A patch to an object that drops the Not sure mark of each field it sets.
function edit<T extends { notSure: string[] }>(obj: T, patch: Partial<T>): T {
  return { ...obj, ...patch, notSure: obj.notSure.filter((k) => !(k in patch)) }
}
let handFiles = 0

/** Returns the form's state and actions; onCreated says whether the intake made them. */
export function useNewAssessment(
  start: CreateStart,
  onCreated: (a: Assessment[], fromIntake: boolean) => void,
) {
  const [form, setForm] = useState<Form>(() => blankForm(start))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  // Date fields whose typed text is not a real date (by field path); Create refuses them.
  const [typed, setTyped] = useState<ReadonlySet<string>>(new Set())
  // Counts refused Creates; the screen scrolls to the first marked field on each.
  const [refused, setRefused] = useState(0)
  // Every recorded client, to choose from and for the "Did you mean" check (CP-17).
  const [clients, setClients] = useState<Client[] | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    listClients(controller.signal).then(setClients, () => {})
    return () => controller.abort()
  }, [])
  // The chosen client's sites (with what a copy would take) and its page (each
  // site's latest status). Should either fail, a new site can still be added.
  const [sites, setSites] = useState<Record<string, ClientSite[]>>({})
  const [pages, setPages] = useState<Record<string, ClientPage | null>>({})
  const clientId = form.client.id
  const sitesOf = clientId ? sites[clientId] : undefined
  useEffect(() => {
    if (!clientId || sites[clientId]) return
    const controller = new AbortController()
    const done = (list: ClientSite[]) => setSites((all) => ({ ...all, [clientId]: list }))
    listClientSites(clientId, controller.signal).then(done, () => {
      if (!controller.signal.aborted) done([])
    })
    getClientPage(clientId, controller.signal).then(
      (page) => setPages((all) => ({ ...all, [clientId]: page })),
      () => {},
    )
    return () => controller.abort()
  }, [clientId, sites])

  const listed = clients?.find((c) => c.id === clientId)
  const clientName = listed?.name ?? form.client.name.trim()
  // Edits clear their own field's problem; adding or removing rows shifts
  // the paths, so it clears them all.
  const update = (next: Form, paths: string[] | null) => {
    setForm(next)
    if (!paths) setTyped(new Set())
    setErrors((all) =>
      paths ? Object.fromEntries(Object.entries(all).filter(([k]) => !paths.includes(k))) : {},
    )
  }
  const setSite = (i: number, patch: Partial<FormSite>) =>
    update(
      { ...form, sites: form.sites.map((s, k) => (k === i ? edit(s, patch) : s)) },
      Object.keys(patch).map((k) => `sites.${i}.${k}`),
    )
  // From the browser's location (CP-26), which answers seconds later: by ref and
  // on the latest form, so what was typed meanwhile isn't undone.
  const setCoordinates = (ref: string, coordinates: string) => {
    setForm((now) => ({
      ...now,
      sites: now.sites.map((s) => (s.ref === ref ? { ...s, coordinates } : s)),
    }))
    setErrors((all) =>
      Object.fromEntries(Object.entries(all).filter(([k]) => !k.endsWith('.coordinates'))),
    )
  }
  const setAssessment = (i: number, j: number, patch: Partial<FormAssessment>) => {
    const assessments = form.sites[i].assessments.map((a, k) => (k === j ? edit(a, patch) : a))
    update(
      { ...form, sites: form.sites.map((s, k) => (k === i ? { ...s, assessments } : s)) },
      Object.keys(patch).map((k) => `sites.${i}.assessments.${j}.${k}`),
    )
  }
  const markTyped = (path: string, bad: boolean) =>
    setTyped((all) => {
      if (all.has(path) === bad) return all
      const next = new Set(all)
      if (bad) next.add(path)
      else next.delete(path)
      return next
    })
  // A removed site or assessment takes its documents back to the whole client.
  const withoutRefs = (next: Form, refs: string[]): Form => ({
    ...next,
    documents: next.documents.map((d) =>
      d.placement.kind !== 'client' && refs.includes(d.placement.ref)
        ? { ...d, placement: { kind: 'client' } }
        : d,
    ),
  })
  const removeSite = (i: number) =>
    update(
      withoutRefs({ ...form, sites: form.sites.filter((_, k) => k !== i) }, [
        form.sites[i].ref,
        ...form.sites[i].assessments.map((a) => a.ref),
      ]),
      null,
    )
  // Changing client keeps the new sites typed in so far; recorded ones go with it.
  const withClient = (clientMode: ClientMode, id: string): Form => {
    const kept = form.sites.filter(
      (s) => (s.choice === NEW_SITE || !s.choice) && (s.name.trim() || s.address.trim()),
    )
    // Documents tagged to a site that goes (or its assessments) go back to the whole client.
    const gone = form.sites
      .filter((s) => !kept.includes(s))
      .flatMap((s) => [s.ref, ...s.assessments.map((a) => a.ref)])
    return withoutRefs(
      {
        ...form,
        clientMode,
        client: { ...form.client, id, notSure: [] },
        sites:
          clientMode === 'new'
            ? kept.length
              ? kept.map((s) => ({ ...s, choice: '' }))
              : [blankSite()]
            : kept.map((s) => ({ ...s, choice: NEW_SITE })),
      },
      gone,
    )
  }

  // Uploads hand-added documents under the created client, then tags those
  // not for the whole client (AC12). Records exist by now, so a failure here
  // says so rather than undoing them.
  async function keepHandDocuments(clientIdMade: string, created: Assessment[]) {
    const hand = form.documents.filter((d) => d.file)
    if (!hand.length) return
    let kept: UploadedFile[]
    try {
      kept = await uploadClientDocuments(
        clientIdMade,
        hand.map((d) => d.file!),
      )
    } catch {
      toast.error('Documents not kept', { description: 'Add them again on the client page.' })
      return
    }
    const refused = kept.filter((k) => k.status === 'refused')
    if (refused.length)
      toast.error(refused.length === 1 ? '1 document not kept' : 'Some documents not kept', {
        description: 'Add them again on the client page.',
      })
    // A tag that fails leaves its document kept under the whole client, so say that, not "not kept".
    const tagged = await Promise.allSettled(
      kept.map((k, n) => {
        if (k.status !== 'kept') return null
        const p = keptPlacement(form, created, hand[n].placement)
        return p.kind === 'client' ? null : retagClientDocument(k.document.id, p)
      }),
    )
    if (tagged.some((t) => t.status === 'rejected'))
      toast.error('Tags not saved', {
        description: 'Kept under Whole client. Retag them on the client page.',
      })
  }

  return {
    form,
    errors,
    typed,
    markTyped,
    busy,
    refused,
    clientName,
    clients: clients ?? [],
    listedClient: listed,
    clientPage: clientId ? pages[clientId] : undefined,
    sitesOf,
    sitesLoading: !!clientId && !sitesOf,
    // A new name close to (or the same as) a recorded client (CP-17 AC11).
    clientSuggestion:
      form.clientMode === 'new' && clients && form.client.name.trim()
        ? (clients.find((c) => c.name.toLowerCase() === form.client.name.trim().toLowerCase())
            ?.name ??
          similarName(
            form.client.name,
            clients.map((c) => c.name),
          ))
        : null,
    siteSuggestion: (site: FormSite) =>
      sitesOf && site.name.trim()
        ? similarName(
            site.name,
            sitesOf.map((x) => x.name),
          )
        : null,
    setClientMode: (mode: ClientMode) =>
      mode !== form.clientMode && update(withClient(mode, ''), null),
    chooseClient: (id: string) => update(withClient('existing', id), null),
    // "Did you mean": the recorded client is chosen instead of a new one.
    useClient: (name: string) => {
      const match = clients?.find((c) => c.name === name)
      if (match) update(withClient('existing', match.id), null)
    },
    setClientName: (name: string) =>
      update({ ...form, client: edit(form.client, { name }) }, ['client.name']),
    setDivision: (division: string) =>
      update({ ...form, client: edit(form.client, { division }) }, ['client.division']),
    setSite,
    setCoordinates,
    // Ticking a recorded site adds its card; unticking removes it.
    toggleSite: (siteId: string) => {
      const at = form.sites.findIndex((s) => s.choice === siteId)
      if (at >= 0) removeSite(at)
      else update({ ...form, sites: [...form.sites, blankSite(siteId)] }, null)
    },
    useSiteName: (i: number, name: string) => {
      const match = sitesOf?.find((x) => x.name === name)
      setSite(i, match ? { choice: match.id } : { name })
    },
    addSite: () =>
      update(
        {
          ...form,
          sites: [...form.sites, blankSite(form.clientMode === 'existing' ? NEW_SITE : '')],
        },
        null,
      ),
    removeSite,
    setAssessment,
    setContacts: (i: number, j: number, siteContacts: Contact[]) =>
      setAssessment(i, j, { siteContacts }),
    addAssessment: (i: number) =>
      update(
        {
          ...form,
          sites: form.sites.map((s, k) =>
            k === i ? { ...s, assessments: [...s.assessments, blankAssessment()] } : s,
          ),
        },
        null,
      ),
    removeAssessment: (i: number, j: number) => {
      const site = form.sites[i]
      const assessments = site.assessments.filter((_, k) => k !== j)
      update(
        withoutRefs(
          { ...form, sites: form.sites.map((s, k) => (k === i ? { ...s, assessments } : s)) },
          [site.assessments[j].ref],
        ),
        null,
      )
    },
    // Hand-added documents are tagged to the whole client (decision 1, AC12).
    addDocuments: (files: File[]) =>
      setForm((now) => ({
        ...now,
        documents: [
          ...now.documents,
          ...files.map((file): FormDocument => ({
            fileId: 'hand-' + ++handFiles,
            name: file.name,
            size: file.size,
            placement: { kind: 'client' },
            notSure: false,
            file,
          })),
        ],
      })),
    removeDocument: (fileId: string) =>
      setForm((now) => ({ ...now, documents: now.documents.filter((d) => d.fileId !== fileId) })),
    restoreDocument: (doc: FormDocument, at: number) =>
      setForm((now) => ({
        ...now,
        documents: [...now.documents.slice(0, at), doc, ...now.documents.slice(at)],
      })),
    setPlacement: (fileId: string, placement: Placement) =>
      setForm((now) => ({
        ...now,
        documents: now.documents.map((d) =>
          d.fileId === fileId ? { ...d, placement, notSure: false } : d,
        ),
      })),
    // The AI's reading replaces the form (AC5).
    fillIn: (next: Form) => update(next, null),
    // Checks the form, then creates everything at once, through the intake
    // when there is one so its documents are kept with their tags (AC10, AC11).
    create: async (intakeId: string | null) => {
      if (busy) return
      const found = validate(form, clientName, sitesOf, typed)
      setErrors(found)
      if (Object.keys(found).length) {
        setRefused((n) => n + 1)
        return
      }
      setBusy(true)
      try {
        const body = toBody(form, sitesOf)
        const read = form.documents.filter((d) => !d.file)
        const created = intakeId
          ? await createFromIntake(intakeId, {
              ...body,
              documents: read.map(({ fileId, placement }) => ({ fileId, placement })),
            })
          : await createAssessments(body)
        await keepHandDocuments(created.clientId, created.assessments)
        onCreated(created.assessments, !!intakeId)
      } catch (error: unknown) {
        const fields = error instanceof GatewayError ? error.fields : {}
        if (Object.keys(fields).length) {
          setErrors(fields)
          setRefused((n) => n + 1)
        }
        toast.error('Nothing created', {
          description: Object.keys(fields).length
            ? 'Correct the marked fields, then create again.'
            : (error instanceof Error ? error.message + ' ' : '') + 'Try again.',
        })
        setBusy(false)
      }
    },
  }
}
