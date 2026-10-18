// Tests for the PDF viewer's byte-range loader (CB-02): ranges fetched past the browser's HTTP
// cache, and kept in memory so a reopened PDF needs no network.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openPdfSource } from './pdfSource'

// pdf.js's transport base class: only the parts the loader touches.
vi.mock('react-pdf', () => ({
  pdfjs: {
    PDFDataRangeTransport: class {
      length: number
      initialData: Uint8Array
      constructor(length: number, initialData: Uint8Array) {
        this.length = length
        this.initialData = initialData
      }
      onDataRange = vi.fn()
    },
  },
}))

// A 200-byte "PDF" whose byte i is i, served one Range at a time as the gateway does.
const FILE = Uint8Array.from({ length: 200 }, (_, i) => i)
function serve() {
  return vi.fn(async (_url: string, init: RequestInit) => {
    const [, first, last] = /bytes=(\d+)-(\d+)/.exec(new Headers(init.headers).get('Range')!)!
    const end = Math.min(Number(last), FILE.length - 1)
    return new Response(FILE.slice(Number(first), end + 1), {
      status: 206,
      headers: { 'Content-Range': `bytes ${first}-${end}/${FILE.length}` },
    })
  })
}
afterEach(() => vi.unstubAllGlobals())

describe('openPdfSource', () => {
  it("reads the file's length and first bytes from one range request, past the HTTP cache", async () => {
    const fetchMock = serve()
    vi.stubGlobal('fetch', fetchMock)

    const source = await openPdfSource('/f/a')

    expect(source.length).toBe(200)
    expect(Array.from(source.initialData!.slice(0, 3))).toEqual([0, 1, 2])
    expect(fetchMock).toHaveBeenCalledOnce()
    // Without no-store, Chrome makes same-URL requests wait for each other (its cache lock).
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
  })

  it('hands pdf.js each range it asks for', async () => {
    vi.stubGlobal('fetch', serve())
    const source = await openPdfSource('/f/b')

    source.requestDataRange(150, 160)

    await vi.waitFor(() => expect(source.onDataRange).toHaveBeenCalled())
    const [begin, chunk] = vi.mocked(source.onDataRange).mock.calls[0]
    expect(begin).toBe(150)
    expect(Array.from(chunk as Uint8Array)).toEqual([
      150, 151, 152, 153, 154, 155, 156, 157, 158, 159,
    ])
  })

  it('reopens a PDF from memory, with no network', async () => {
    const fetchMock = serve()
    vi.stubGlobal('fetch', fetchMock)
    const first = await openPdfSource('/f/c')
    first.requestDataRange(150, 160)
    await vi.waitFor(() => expect(first.onDataRange).toHaveBeenCalled())
    fetchMock.mockClear()

    const again = await openPdfSource('/f/c')
    again.requestDataRange(150, 160)

    await vi.waitFor(() => expect(again.onDataRange).toHaveBeenCalled())
    expect(again.length).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
