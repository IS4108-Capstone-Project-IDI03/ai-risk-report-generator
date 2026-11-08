// Tests for the browser check of picked files (CP-22 AC9-AC13). Covers uploadTypes.ts.
import { describe, expect, it } from 'vitest'
import { PHOTO_ACCEPT, RECORDING_ACCEPT, refusalOf } from './uploadTypes'

const file = (name: string, type: string, size = 10) => ({ name, type, size })

describe('what the pickers offer', () => {
  it('lists types by MIME and extension, never image/* (it admits SVG)', () => {
    expect(PHOTO_ACCEPT).toContain('image/heic')
    expect(PHOTO_ACCEPT).toContain('.heic')
    expect(PHOTO_ACCEPT).not.toContain('image/*')
    expect(PHOTO_ACCEPT).not.toContain('svg')
    expect(RECORDING_ACCEPT).toContain('audio/mp4')
    expect(RECORDING_ACCEPT).toContain('.m4a')
  })
})

describe('refusalOf', () => {
  it('lets the allowed types through', () => {
    expect(refusalOf(file('a.heic', 'image/heic'), 'photo')).toBeNull()
    expect(refusalOf(file('a.JPG', ''), 'photo')).toBeNull()
    expect(refusalOf(file('walk.m4a', 'audio/x-m4a'), 'recording')).toBeNull()
  })

  it('names the wrong type, with its extension when there is one', () => {
    expect(refusalOf(file('plan.pdf', 'application/pdf'), 'photo')).toEqual({
      title: "Can't add .pdf files",
      fix: 'Choose a photo',
    })
    expect(refusalOf(file('logo.svg', 'image/svg+xml'), 'photo')?.title).toBe(
      "Can't add .svg files",
    )
    expect(refusalOf(file('notes', 'text/plain'), 'recording')).toEqual({
      title: "Can't add this file",
      fix: 'Choose a recording',
    })
  })

  it('leaves a file with no type and no extension to the gateway', () => {
    expect(refusalOf(file('IMG', ''), 'photo')).toBeNull()
    expect(refusalOf(file('IMG', 'application/octet-stream'), 'photo')).toBeNull()
  })

  it('refuses a file over the limit: photo 20 MB, recording 100 MB', () => {
    const large = { title: 'File is too large', fix: 'Choose a smaller one' }
    expect(refusalOf(file('a.jpg', 'image/jpeg', 20_000_001), 'photo')).toEqual(large)
    expect(refusalOf(file('a.jpg', 'image/jpeg', 20_000_000), 'photo')).toBeNull()
    expect(refusalOf(file('a.wav', 'audio/wav', 100_000_001), 'recording')).toEqual(large)
  })
})
