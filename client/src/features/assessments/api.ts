// Gateway (S2) calls for assessments. Requests go to /api, which Vite proxies
// to the gateway in development.

export type NewAssessment = {
  site: { name: string; address?: string; jurisdiction: string; facilityType: string }
  client: string
  policyReference?: string
  surveyType: string
  // YYYY-MM-DD, or '' when not scheduled.
  siteVisitDate?: string
  reportDueDate?: string
  standards: string[]
  // The first engineer is the lead.
  engineers: string[]
}

// Capture statuses come from the assessment's capture session; report
// statuses are stored once a report exists.
export type AssessmentStatus =
  'not_started' | 'capturing' | 'ready_to_generate' | 'draft' | 'under_review' | 'finalised'

export type Assessment = {
  id: string
  reference: string
  client: string
  policyReference: string | null
  surveyType: string
  siteVisitDate: string | null
  reportDueDate: string | null
  standards: string[]
  engineers: string[]
  status: AssessmentStatus
  createdAt: string
  site: {
    code: string
    name: string
    address: string | null
    jurisdiction: string
    facilityType: string
  }
}

export type CaptureSession = {
  // True when the assessment's session in progress was returned (HTTP 200)
  // rather than a new one started (HTTP 201).
  resumed: boolean
  session: { id: string; status: 'active' | 'ready_for_generation'; startedAt: string }
  assessment: {
    id: string
    reference: string
    client: string
    site: { code: string; name: string } | null
  }
}

export class GatewayError extends Error {
  // HTTP status from the gateway, or null when no response arrived.
  readonly status: number | null
  // Problems with individual fields from a 400, keyed by path, e.g. "site.name".
  readonly fields: Record<string, string>

  constructor(status: number | null, message?: string, fields: Record<string, string> = {}) {
    super(
      message ??
        (status === null
          ? 'The gateway could not be reached.'
          : `The gateway returned HTTP ${status}.`),
    )
    this.name = 'GatewayError'
    this.status = status
    this.fields = fields
  }
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ status: number; data: T }> {
  let response: Response
  try {
    response = await fetch(path, {
      method,
      signal,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch (error: unknown) {
    if (signal?.aborted) throw error
    throw new GatewayError(null)
  }
  // Proxies, including Vite's dev proxy, answer 502/504 when the gateway is
  // down: the gateway itself sent nothing.
  if (response.status === 502 || response.status === 504) throw new GatewayError(null)
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as {
      error?: string
      fields?: Record<string, string>
    }
    throw new GatewayError(response.status, problem.error, problem.fields)
  }
  return { status: response.status, data: (await response.json()) as T }
}

// Every assessment, most recent site visit first (RV-10).
export async function listAssessments(signal?: AbortSignal): Promise<Assessment[]> {
  return (await request<Assessment[]>('GET', '/api/assessments', undefined, signal)).data
}

// Creates the assessment and its site; the server allocates the reference.
export async function createAssessment(input: NewAssessment): Promise<Assessment> {
  return (await request<Assessment>('POST', '/api/assessments', input)).data
}

// Starts the assessment's capture session, or returns the one in progress.
export async function startCaptureSession(
  reference: string,
  signal?: AbortSignal,
): Promise<CaptureSession> {
  const { status, data } = await request<Omit<CaptureSession, 'resumed'>>(
    'POST',
    `/api/assessments/${encodeURIComponent(reference)}/capture-session`,
    undefined,
    signal,
  )
  return { ...data, resumed: status === 200 }
}
