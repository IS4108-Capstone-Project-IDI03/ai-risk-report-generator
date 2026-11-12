// MarshBot's AI calls (AS-06): the wording AI's program for a turn is kept only
// when it draws every card of the turn once and adds no number or name, and
// the coverage check runs in the background, its failure said once without
// breaking the conversation (AC 7).
// rag-service is faked (assistant-fixtures.ts); nothing leaves the machine.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import app from '../index'
import { AiCallModel } from '../models/ai-call.model'
import { settleBackground } from '../services/assistant/background'
import { AssessmentModel } from '../models/assessment.model'
import { AssistantBriefModel } from '../models/assistant-brief.model'
import { CaptureSessionModel } from '../models/capture-session.model'
import { onBriefChanged } from '../services/assistant/bus'
import { coverageWhenDue } from '../services/assistant/coverage.service'
import { COVERAGE_FAILED } from '../services/assistant/thread/topics-capture'
import type { AssistantThread, Turn } from '../services/assistant/types'
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
const thread = (res: { body: unknown }) => res.body as AssistantThread
const coverageOf = async () =>
  (await AssistantBriefModel.findOne({ reference: REF }).lean())!.coverage

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
  const turn = {
    id: 's1-2',
    who: 'bot',
    at: '2026-11-14T02:00:00.000Z',
    topic: 'todo',
    mood: 'concerned',
    says: [
      { text: 'There are 2 things I need you to sort out first.', tone: 'normal' },
      { text: "A recording from Loading Bay 2 couldn't be transcribed.", tone: 'normal' },
    ],
    cards: [{ id: 's1-2-todo' }, { id: 's1-2-thin' }],
    program: null,
  } as unknown as Turn
  const program = (words: string, cards = 'b, c') =>
    `root = Reply([a, ${cards}])\na = Say("${words}")\nb = Card("s1-2-todo")\nc = Card("s1-2-thin")`

  it('keeps a program that rewords the turn and draws each card once', () => {
    const ok = program(
      'Loading Bay 2 has a recording that needs another try, and there are 2 things to sort.',
    )
    expect(checkedProgram(ok, turn)).toBe(ok)
    const good =
      'root = Reply([a, b, c])\na = Say("Nice work.", "good")\nb = Card("s1-2-todo")\nc = Card("s1-2-thin")'
    expect(checkedProgram(good, turn)).toBe(good)
  })

  it('drops a program with an unknown component, root or card, a left-out card, or a card twice', () => {
    expect(checkedProgram('root = Reply([a])\na = Table("x")', turn)).toBeNull()
    expect(checkedProgram('a = Say("Hello")', turn)).toBeNull()
    expect(checkedProgram(program('Hello.', 'b'), turn)).toBeNull()
    expect(checkedProgram(program('Hello.', 'b, b, c'), turn)).toBeNull()
    expect(checkedProgram(program('Hello.').replace('s1-2-thin', 's1-2-x'), turn)).toBeNull()
    // Defined but not reachable from root: OpenUI would never draw it.
    expect(checkedProgram(program('Hello.', 'b') + '\nd = Reply([c])', turn)).toBeNull()
    // A Say's tone may only be "good".
    expect(
      checkedProgram(program('Hello.').replace('Say("Hello.")', 'Say("Hello.", "red")'), turn),
    ).toBeNull()
  })

  it("drops a program with a string JSON can't read, without throwing (#43)", () => {
    expect(checkedProgram(program("It\\'s Loading Bay 2."), turn)).toBeNull()
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

  it("drops a program with a number or a name the turn's words never said (#51)", () => {
    expect(checkedProgram(program('3 recordings from Loading Bay 2 failed.'), turn)).toBeNull()
    const names = ['Fire Protection', 'Loading Bay 2']
    expect(checkedProgram(program('Fire Protection needs 2 things.'), turn, names)).toBeNull()
    const ok = program('Loading Bay 2 needs 2 things from you.')
    expect(checkedProgram(ok, turn, names)).toBe(ok)
    // A name the turn says can't be dropped: a reworded catch-up can't change what it names.
    expect(checkedProgram(program('There are 2 things to sort first.'), turn, names)).toBeNull()
  })
})

describe('wording a turn', () => {
  it('keeps the programs that pass, set once and never changed', async () => {
    const { engineer } = await people()
    const a = await assessment(engineer._id)
    await observation(a._id, (await session(a._id))._id, { failed: true })
    rag.wording = () => {
      const call = rag.calls.filter((c) => c.path === '/assistant/wording').at(-1)!.body as {
        messages: { id: string; parts: { type: string; id?: string }[] }[]
      }
      const [greeting, todo] = call.messages
      const card = todo.parts.find((p) => p.type === 'card')!.id
      return json({
        programs: {
          [greeting.id]: 'root = Reply([a])\na = Say("Good morning, Alex! 99 things.")',
          [todo.id]: `root = Reply([a, b])\na = Say("1 recording from Loading Bay 2 needs another try.")\nb = Card("${card}")`,
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

    await api.get(url)
    await settleBackground()
    const t = thread(await api.get(url))
    const [greeting, todo] = t.session.turns
    // 99 was never said: the greeting keeps its template words.
    expect(greeting.program).toBeNull()
    expect(todo.program).toMatch(/^root = Reply\(\[a, b\]\)/)
    const sent = rag.calls.find((c) => c.path === '/assistant/wording')!.body as {
      messages: { parts: { type: string }[] }[]
    }
    expect(sent.messages[1].parts.map((p) => p.type)).toEqual(['say', 'say', 'card'])
    expect(await AiCallModel.countDocuments({ feature: 'assistant-wording', reportId: REF })).toBe(
      1,
    )
    // The same turns aren't worded twice.
    await api.get(url)
    await settleBackground()
    expect(rag.calls.filter((c) => c.path === '/assistant/wording')).toHaveLength(1)
  })
})

describe('when the wording fails', () => {
  it('shows the turns in their template words and still pushes (ledger #6)', async () => {
    const { engineer } = await people()
    await assessment(engineer._id)
    rag.wording = () => json({ detail: 'down' }, 502)
    const pushes: string[] = []
    const stop = onBriefChanged(REF, (at) => pushes.push(at))
    const api = signedInAs(app, engineer)
    expect(thread(await api.get(url)).thinking).toBe(true)
    await settleBackground()
    stop()
    // The re-check's push, the new turns' push, and the push once the wording attempt
    // ended, so the open Overview reads again and the dots go.
    expect(pushes.length).toBeGreaterThanOrEqual(3)
    const t = thread(await api.get(url))
    expect(t.thinking).toBe(false)
    expect(t.session.turns.map((x) => [x.topic, x.program])).toEqual([
      ['greeting', null],
      ['setup', null],
      ['question', null],
    ])
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

  it('runs after the conversation is sent, and its failure is said once without breaking it', async () => {
    const { api } = await capturing()
    const first = await api.get(url)
    expect(first.status).toBe(200)
    await settleBackground()
    expect((await coverageOf()).status).toBe('failed')

    const asked = await api.post(`${url}/replies`).send({ replyId: 'what-else' })
    expect(asked.status).toBe(200)
    await settleBackground()
    const t = thread(await api.get(url))
    const failed = t.session.turns.filter((x) => x.says.some((s) => s.text === COVERAGE_FAILED))
    expect(failed).toHaveLength(1)
    expect(t.replies).toEqual([])
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
    expect((await coverageOf()).status).toBe('done')
  })

  it('raises the uncovered checklist items, after the checklist', async () => {
    const { api, itemId } = await capturing()
    rag.coverage = () => json({ uncovered: [itemId, 'not-an-item'], thin: [], usage: [] })
    await api.get(url)
    await settleBackground()

    expect((await coverageOf()).status).toBe('done')
    const items = (await AssistantBriefModel.findOne({ reference: REF }).lean())!.items
    expect(items.find((i) => i.id === 'coverage.uncovered:9')).toMatchObject({
      title: 'Fire Protection',
      detail: '1 checklist item no observation covers',
    })
    await api.post(`${url}/replies`).send({ replyId: 'what-else' })
    await settleBackground()
    const gaps = thread(await api.get(url)).session.turns.at(-1)!
    expect(gaps.topic).toBe('gaps')
    expect(gaps.cards[0]).toMatchObject({
      title: 'Not Covered',
      rows: [{ title: 'Check the sprinkler valves are open.', detail: 'Fire Protection' }],
    })
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
