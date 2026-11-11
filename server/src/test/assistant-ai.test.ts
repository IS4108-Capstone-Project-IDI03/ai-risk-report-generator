// MarshBot's AI calls (AS-06): the wording AI's programs are kept only when
// they name known ids and no new numbers, and the coverage check runs in the
// background, its failure said once without breaking the brief (AC 7).
// rag-service is faked (assistant-fixtures.ts); nothing leaves the machine.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { settleBackground } from '../services/assistant/background'
import { AssessmentModel } from '../models/assessment.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { coverageWhenDue } from '../services/assistant/coverage.service'
import { message } from '../services/assistant/message-parts'
import { COVERAGE_FAILED } from '../services/assistant/messages'
import type { AssistantBrief, BriefItem } from '../services/assistant/types'
import { checkedProgram, MARSHBOT_COMPONENTS } from '../services/assistant/wording.service'
import { drainInlineJobs } from '../services/job-queue.service'
import { signedInAs } from './auth-test-helpers'
import {
  assessment,
  checklist,
  observation,
  people,
  rag,
  REF,
  session,
  stubRag,
} from './assistant-fixtures'
import { useMemoryMongo } from './memory-mongo'

useMemoryMongo()

const url = `/api/assessments/${REF}/assistant`
const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-14T02:00:00Z'))
  stubRag()
})
afterEach(async () => {
  await drainInlineJobs()
  await settleBackground()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('checking a wording program', () => {
  const item = {
    id: 'capture.failed-recording:o1:r1',
    title: 'Loading Bay 2',
    detail: "Recording 1 · Couldn't transcribe",
    facts: { recording: 'Recording 1' },
  } as unknown as BriefItem
  const said = message(
    'fix-now',
    "A recording from Loading Bay 2 couldn't be transcribed. A retry usually sorts that out.",
    [
      { type: 'actions', itemIds: [item.id] },
      { type: 'link', label: 'Open Observations', link: { tab: 'observations' }, icon: 'camera' },
    ],
  )
  const program = (body: string) =>
    `root = Reply([a, b, c])\na = Say("${body}")\nb = ActionRow("${item.id}")\nc = LinkButton("Open Observations", "link-1")`

  it('keeps a program that rewords the message', () => {
    const ok = program('Loading Bay 2 has a recording that needs a retry.')
    expect(checkedProgram(ok, said, [item])).toBe(ok)
    const linked = `root = Reply([a])\na = LinkButton("Open Observations", "link-1")`
    expect(checkedProgram(linked, said, [item])).toBe(linked)
  })

  it('drops a program with an unknown id, component or link', () => {
    expect(
      checkedProgram('root = Reply([b])\nb = ActionRow("walk.ready:x")', said, [item]),
    ).toBeNull()
    expect(checkedProgram('root = Reply([b])\nb = Table("x")', said, [item])).toBeNull()
    expect(
      checkedProgram('root = Reply([a])\na = LinkButton("Go", "link-0")', said, [item]),
    ).toBeNull()
    expect(checkedProgram('a = Say("Hello")', said, [item])).toBeNull()
  })

  it('drops a program that leaves out a control the message needs (#2)', () => {
    const setup = message('setup-question', 'Anything more to add?', [
      {
        type: 'replies',
        replies: [{ id: 'nothing-more', label: 'Nothing more', primary: true, picksDate: false }],
      },
    ])
    expect(checkedProgram('root = Reply([a])\na = Say("Anything to add?")', setup, [])).toBeNull()
    // Defined but not reachable from root: OpenUI would never draw it.
    expect(
      checkedProgram(
        'root = Reply([a])\na = Say("Anything to add?")\nb = QuickReply("nothing-more")',
        setup,
        [],
      ),
    ).toBeNull()
    const ok = 'root = Reply([a, b])\na = Say("Anything to add?")\nb = QuickReply("nothing-more")'
    expect(checkedProgram(ok, setup, [])).toBe(ok)
    // A Fix now item's row must be drawn; a gap's may be left out.
    const fixNow = { ...item, weight: 'fix_now' } as BriefItem
    const noRow = 'root = Reply([c])\nc = LinkButton("Open Observations", "link-1")'
    expect(checkedProgram(noRow, said, [fixNow])).toBeNull()
    expect(checkedProgram(noRow, said, [item])).toBe(noRow)
  })

  it("drops a program with a string JSON can't read, without throwing (#43)", () => {
    expect(checkedProgram(program("It\\'s Loading Bay 2."), said, [item])).toBeNull()
  })

  it("names the same components as rag-service's prompt", () => {
    const prompt = readFileSync(
      resolve(
        __dirname,
        '../../../microservices/rag-service/app/assistant/marshbot_components.txt',
      ),
      'utf8',
    )
    const signatures = prompt.split('## Component Signatures')[1].split('\n## ')[0]
    expect([...signatures.matchAll(/^([A-Z]\w*)\(/gm)].map((m) => m[1]).sort()).toEqual(
      [...MARSHBOT_COMPONENTS].sort(),
    )
  })

  it('drops a program with a number the rules never said', () => {
    expect(
      checkedProgram(program('3 recordings from Loading Bay 2 failed.'), said, [item]),
    ).toBeNull()
  })

  it("drops a program that names numbers or areas its message doesn't (#51)", () => {
    // A number only in the row's facts is the row's to show, not the words'.
    expect(
      checkedProgram(program('Recording 1 from Loading Bay 2 needs a retry.'), said, [item]),
    ).toBeNull()
    // RPT-2026-0072: the rules named the two thin areas; the AI pointed at a nearly-done one.
    const health = message(
      'health',
      "Here's the checklist by area. External Exposures has nothing yet and Fire Protection is at 4 of 12, so cover those if you can.",
      [
        { type: 'health', areas: [] },
        { type: 'link', label: 'Add observation', link: { tab: 'observations' }, icon: 'plus' },
      ],
    )
    const names = ['Management Programs', 'External Exposures', 'Fire Protection']
    const words = (text: string) =>
      `root = Reply([a, b, c])\na = Say("${text}")\nb = HealthBars()\nc = LinkButton("Add observation", "link-1")`
    const swapped = words(
      'External Exposures has nothing yet. Management Programs is at 4 of 12, so cover those if you can.',
    )
    expect(checkedProgram(swapped, health, [], names)).toBeNull()
    const ok = words(
      'External Exposures has nothing recorded yet, and Fire Protection is at 4 of 12. Worth covering those two.',
    )
    expect(checkedProgram(ok, health, [], names)).toBe(ok)
  })
})

describe('wording on the brief', () => {
  it('attaches the programs that pass and leaves the rest as plain text', async () => {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    const failed = await observation(a._id, (await session(a._id))._id, { failed: true })
    const recording = `capture.failed-recording:${failed.id}:${failed.recordings[0]._id}`
    rag.wording = () => {
      const call = rag.calls.filter((c) => c.path === '/assistant/wording').at(-1)!.body as {
        messages: { id: string }[]
      }
      const [greeting, fix] = call.messages
      return json({
        programs: {
          [greeting.id]: 'root = Reply([a])\na = Say("Morning, Alex. One thing to fix first.")',
          [fix.id]: `root = Reply([a])\na = ActionRow("${recording}x")`,
        },
        usage: [
          {
            feature: 'assistant-wording',
            billed_service: 'anthropic',
            model: 'claude-sonnet-5-5',
            input_tokens: 10,
            output_tokens: 5,
          },
        ],
      })
    }
    const api = signedInAs(app, engineer)

    const first = (await api.get(url)).body as AssistantBrief
    expect(first.messages.every((m) => m.program === null)).toBe(true)
    await settleBackground()
    const second = (await api.get(url)).body as AssistantBrief

    expect(second.messages[0].program).toBe(
      'root = Reply([a])\na = Say("Morning, Alex. One thing to fix first.")',
    )
    expect(second.messages[1].program).toBeNull()
    expect(await AiCallModel.countDocuments({ feature: 'assistant-wording', reportId: REF })).toBe(
      1,
    )
    // The same message set isn't worded twice.
    expect(rag.calls.filter((c) => c.path === '/assistant/wording')).toHaveLength(1)
  })
})

describe('who pays for wording', () => {
  const wordingCalls = () => rag.calls.filter((c) => c.path === '/assistant/wording')

  it("asks for none when an admin opens someone else's assessment (#16)", async () => {
    const { engineer, admin } = await people()
    await assessment(engineer._id)
    expect((await signedInAs(app, admin).get(url)).status).toBe(200)
    await settleBackground()
    expect(wordingCalls()).toHaveLength(0)
  })

  it('asks once when the engineer opens it twice at the same moment (#44)', async () => {
    const { engineer } = await people()
    await assessment(engineer._id)
    const api = signedInAs(app, engineer)
    await Promise.all([api.get(url), api.get(url)])
    await settleBackground()
    expect(wordingCalls()).toHaveLength(1)
  })
})

describe('the coverage check (AC 7)', () => {
  async function capturing() {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    const list = await checklist(a._id, engineer._id)
    await observation(a._id, (await session(a._id))._id)
    return { api: signedInAs(app, engineer), itemId: String(list.items[0]._id) }
  }

  it('runs after the brief is sent, and its failure is said once without breaking the brief', async () => {
    const { api } = await capturing()
    const first = await api.get(url)
    expect(first.status).toBe(200)
    expect((first.body as AssistantBrief).coverage.status).toBe('running')
    expect((first.body as AssistantBrief).mood).toBe('thinking')
    await settleBackground()

    const res = await api.get(url)
    expect(res.status).toBe(200)
    const b = res.body as AssistantBrief
    expect(b.coverage.status).toBe('failed')
    expect(b.messages.filter((m) => m.text === COVERAGE_FAILED)).toHaveLength(1)
    // Not retried within five minutes.
    expect(rag.calls.filter((c) => c.path === '/assistant/coverage')).toHaveLength(1)
  })

  it('runs once the 5 minutes are up when evidence changed in between, while the Overview is open (#5)', async () => {
    const { api } = await capturing()
    await api.get(url)
    await settleBackground()
    const coverageCalls = () => rag.calls.filter((c) => c.path === '/assistant/coverage')
    expect(coverageCalls()).toHaveLength(1)

    // A minute later the evidence changes: held back by the interval, not run.
    vi.setSystemTime(new Date('2026-11-14T02:01:00Z'))
    const [a] = await AssessmentModel.find()
    const [s] = await CaptureSessionModel.find()
    await observation(a._id, s._id)
    await api.get(url)
    await drainInlineJobs()
    await settleBackground()
    expect(coverageCalls()).toHaveLength(1)
    expect(await coverageWhenDue(REF)).toBe(false)

    // The delayed job, once the interval is over, runs it and saves the result.
    vi.setSystemTime(new Date('2026-11-14T02:05:30Z'))
    rag.coverage = () => json({ uncovered: [], thin: [], usage: [] })
    expect(await coverageWhenDue(REF)).toBe(true)
    expect(coverageCalls()).toHaveLength(2)
    expect(((await api.get(url)).body as AssistantBrief).coverage.status).toBe('done')
  })

  it('raises the uncovered checklist items by area, after the rest', async () => {
    const { api, itemId } = await capturing()
    rag.coverage = () => json({ uncovered: [itemId, 'not-an-item'], thin: [], usage: [] })
    await api.get(url)
    await settleBackground()

    const b = (await api.get(url)).body as AssistantBrief
    expect(b.coverage.status).toBe('done')
    expect(b.items.find((i) => i.id === 'coverage.uncovered:9')).toMatchObject({
      title: 'Fire Protection',
      detail: '1 checklist item no observation covers',
    })
    expect(b.messages.at(-1)?.parts).toEqual([
      { type: 'actions', itemIds: ['coverage.uncovered:9'] },
    ])
    const sent = rag.calls.find((c) => c.path === '/assistant/coverage')!.body as {
      observations: unknown[]
      checklist: unknown[]
    }
    expect(sent.checklist).toEqual([
      { id: itemId, area: 'Fire Protection', text: 'Check the sprinkler valves are open.' },
    ])
    expect(sent.observations).toHaveLength(1)
  })
})
