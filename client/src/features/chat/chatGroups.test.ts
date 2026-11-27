import { describe, expect, it } from 'vitest'
import { groupByRecency, recencyLabel } from './chatGroups'

const now = new Date(2026, 10, 27, 9, 0)

describe('recencyLabel', () => {
  it('counts calendar days, not 24 hour spans', () => {
    expect(recencyLabel(new Date(2026, 10, 27, 0, 5), now)).toBe('Today')
    expect(recencyLabel(new Date(2026, 10, 26, 23, 50), now)).toBe('Yesterday')
    expect(recencyLabel(new Date(2026, 10, 20, 12, 0), now)).toBe('Previous 7 days')
    expect(recencyLabel(new Date(2026, 10, 19, 12, 0), now)).toBe('Older')
  })
  it('puts a chat with no date (an optimistic rename) under Today', () => {
    expect(recencyLabel(undefined, now)).toBe('Today')
    expect(recencyLabel(0, now)).toBe('Today')
  })
})

describe('groupByRecency', () => {
  it('keeps the list order and drops empty groups', () => {
    const chats = [
      { id: 'a', createdAt: new Date(2026, 10, 27, 8).toISOString() },
      { id: 'b', createdAt: new Date(2026, 10, 1).toISOString() },
      { id: 'c', createdAt: new Date(2026, 10, 27, 7).toISOString() },
    ]
    expect(groupByRecency(chats, now)).toEqual([
      { label: 'Today', items: [chats[0], chats[2]] },
      { label: 'Older', items: [chats[1]] },
    ])
  })
})
