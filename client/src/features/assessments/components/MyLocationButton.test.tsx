// The Use my current location button and FindMyBlock (CP-26). Location is faked.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { streetAddress } from '../googleMaps'
import { FindMyBlock } from './FindMyBlock'
import { MyLocationButton } from './MyLocationButton'

// Never reaches Google: each real lookup is billed.
vi.mock('../googleMaps', async (original) => ({
  ...(await original<typeof import('../googleMaps')>()),
  streetAddress: vi.fn(),
}))

const HERE = { latitude: 1.2966, longitude: 103.852, accuracy: 20 }
let coords = HERE
const button = () => screen.getByRole('button', { name: 'Use my current location' })

beforeEach(() => {
  coords = HERE
  vi.stubGlobal('navigator', {
    ...navigator,
    geolocation: {
      getCurrentPosition: (done: (p: unknown) => void) => done({ coords }),
    },
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MyLocationButton', () => {
  it('hands over the point alone, so only a pin ever saves it (AC18, AC21)', async () => {
    const onFound = vi.fn()
    render(<MyLocationButton onFound={onFound} />)
    fireEvent.click(button())
    await vi.waitFor(() => expect(onFound).toHaveBeenCalledWith({ lat: 1.2966, lng: 103.852 }))
  })

  it('says how to carry on when permission is refused (AC20)', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_: unknown, failed: (e: unknown) => void) =>
          failed({ code: 1, PERMISSION_DENIED: 1 }),
      },
    })
    const onFound = vi.fn()
    render(<MyLocationButton onFound={onFound} />)
    fireEvent.click(button())
    expect(await screen.findByRole('status')).toHaveTextContent(/Allow location/)
    expect(onFound).not.toHaveBeenCalled()
  })
})

describe('a slow answer', () => {
  it('saves nothing once the engineer has left, so a cancelled pin stays unsaved (AC21)', async () => {
    let answer = (_: unknown) => {}
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition: (done: (p: unknown) => void) => (answer = done) },
    })
    const onFound = vi.fn()
    const view = render(<MyLocationButton onFound={onFound} />)
    fireEvent.click(button())
    view.unmount()
    answer({ coords: HERE })
    await Promise.resolve()
    await Promise.resolve()
    expect(onFound).not.toHaveBeenCalled()
  })

  it('refuses a rough position for a pin too (AC17)', async () => {
    coords = { ...HERE, accuracy: 900 }
    const onFound = vi.fn()
    render(<MyLocationButton onFound={onFound} />)
    fireEvent.click(button())
    expect(await screen.findByRole('status')).toHaveTextContent(/too rough/)
    expect(onFound).not.toHaveBeenCalled()
  })
})

describe('FindMyBlock', () => {
  const near = { name: 'Block A', lat: 1.2967, lng: 103.852 }
  const far = { name: 'Block B', lat: 1.31, lng: 103.852 }
  const AT_B = { ...HERE, latitude: 1.31 }
  const track = () => screen.getByRole('button', { name: 'Track my location' })
  // The browser's live feed, driven by hand.
  let move = (_: unknown) => {}
  let fail = (_: unknown) => {}
  const cleared = vi.fn()

  beforeEach(() => {
    cleared.mockClear()
    vi.mocked(streetAddress).mockReset().mockResolvedValue('10 Bayfront Avenue, Singapore')
    vi.stubGlobal('navigator', {
      geolocation: {
        watchPosition: (onMove: typeof move, onFail: typeof fail) => {
          move = onMove
          fail = onFail
          return 7
        },
        clearWatch: cleared,
      },
    })
  })
  const moveTo = (to: typeof HERE) => act(() => move({ coords: to }))

  it('follows the engineer from block to block (AC14)', () => {
    const onBlock = vi.fn()
    render(<FindMyBlock pins={[far, near]} onHere={vi.fn()} onBlock={onBlock} />)
    fireEvent.click(track())
    moveTo(HERE)
    expect(onBlock).toHaveBeenLastCalledWith('Block A')
    expect(screen.getByRole('status')).toHaveTextContent('You’re near Block A.')
    moveTo(AT_B)
    expect(onBlock).toHaveBeenLastCalledWith('Block B')
  })

  it('shows where the engineer is, within how far (AC14)', () => {
    render(<FindMyBlock pins={[near]} onHere={vi.fn()} onBlock={vi.fn()} />)
    fireEvent.click(track())
    moveTo(HERE)
    expect(screen.getByText(/within 20 m/)).toBeVisible()
  })

  it('shows the nearest address, looked up again only after 50 m (AC27)', async () => {
    render(<FindMyBlock pins={[near]} onHere={vi.fn()} onBlock={vi.fn()} />)
    fireEvent.click(track())
    moveTo(HERE)
    expect(await screen.findByText('Near 10 Bayfront Avenue, Singapore')).toBeVisible()
    moveTo({ ...HERE, latitude: HERE.latitude + 0.0001 })
    expect(streetAddress).toHaveBeenCalledTimes(1)
    moveTo({ ...HERE, latitude: HERE.latitude + 0.001 })
    expect(streetAddress).toHaveBeenCalledTimes(2)
    await act(async () => {})
  })

  it('pays for no lookup when GPS only drifts within its accuracy (AC27)', () => {
    render(<FindMyBlock pins={[near]} onHere={vi.fn()} onBlock={vi.fn()} />)
    fireEvent.click(track())
    moveTo({ ...HERE, accuracy: 200 })
    moveTo({ ...HERE, latitude: HERE.latitude + 0.001, accuracy: 200 })
    expect(streetAddress).toHaveBeenCalledTimes(1)
  })

  it('keeps the latest address when an older lookup answers last (AC27)', async () => {
    let older = (_: string) => {}
    vi.mocked(streetAddress)
      .mockReturnValueOnce(new Promise((done) => (older = done as typeof older)))
      .mockResolvedValueOnce('New Street')
    render(<FindMyBlock pins={[near]} onHere={vi.fn()} onBlock={vi.fn()} />)
    fireEvent.click(track())
    moveTo(HERE)
    moveTo({ ...HERE, latitude: HERE.latitude + 0.001 })
    await act(async () => older('Old Street'))
    expect(await screen.findByText('Near New Street')).toBeVisible()
  })

  it('looks up no address for a rough position (AC27)', () => {
    render(<FindMyBlock pins={[near]} onHere={vi.fn()} onBlock={vi.fn()} />)
    fireEvent.click(track())
    moveTo({ ...HERE, accuracy: 900 })
    expect(streetAddress).not.toHaveBeenCalled()
  })

  it('carries on without an address when Google has none (AC27)', async () => {
    vi.mocked(streetAddress).mockResolvedValue(null)
    render(<FindMyBlock pins={[near]} onHere={vi.fn()} onBlock={vi.fn()} />)
    fireEvent.click(track())
    moveTo(HERE)
    await act(async () => {})
    expect(screen.queryByText(/^Near /)).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('You’re near Block A.')
  })

  it('drops an address that arrives after tracking stopped (AC27)', async () => {
    let answer = (_: string) => {}
    vi.mocked(streetAddress).mockReturnValueOnce(
      new Promise((done) => (answer = done as typeof answer)),
    )
    render(<FindMyBlock pins={[near]} onHere={vi.fn()} onBlock={vi.fn()} />)
    fireEvent.click(track())
    moveTo(HERE)
    fireEvent.click(screen.getByRole('button', { name: 'Stop tracking' }))
    fireEvent.click(track())
    moveTo(HERE)
    await act(async () => answer('Old Street'))
    expect(screen.queryByText('Near Old Street')).toBeNull()
  })

  it('widens the list again on walking out of range, and says so (AC16)', () => {
    const onBlock = vi.fn()
    render(<FindMyBlock pins={[near]} onHere={vi.fn()} onBlock={onBlock} />)
    fireEvent.click(track())
    moveTo(HERE)
    moveTo(AT_B)
    expect(onBlock).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('status')).toHaveTextContent(/not near a pinned block/)
  })

  it('still tracks with no blocks pinned, and says so (AC16)', () => {
    render(<FindMyBlock pins={[]} onHere={vi.fn()} onBlock={vi.fn()} />)
    fireEvent.click(track())
    moveTo(HERE)
    expect(screen.getByRole('status')).toHaveTextContent(/No blocks are pinned/)
  })

  it('guesses no block from a rough position (AC17)', () => {
    const onBlock = vi.fn()
    render(<FindMyBlock pins={[near]} onHere={vi.fn()} onBlock={onBlock} />)
    fireEvent.click(track())
    moveTo({ ...HERE, accuracy: 900 })
    expect(screen.getByRole('status')).toHaveTextContent(/too rough/)
    expect(onBlock).not.toHaveBeenCalledWith('Block A')
  })

  it('stops following on Stop tracking, and when the picker closes (AC26)', () => {
    const onBlock = vi.fn()
    const view = render(<FindMyBlock pins={[near]} onHere={vi.fn()} onBlock={onBlock} />)
    fireEvent.click(track())
    moveTo(HERE)
    fireEvent.click(screen.getByRole('button', { name: 'Stop tracking' }))
    expect(cleared).toHaveBeenCalledWith(7)
    expect(onBlock).toHaveBeenLastCalledWith(null)
    fireEvent.click(track())
    view.unmount()
    expect(cleared).toHaveBeenCalledTimes(2)
  })

  it('stops when permission is refused, but rides out a lost signal (AC20)', () => {
    render(<FindMyBlock pins={[near]} onHere={vi.fn()} onBlock={vi.fn()} />)
    fireEvent.click(track())
    act(() => fail({ code: 2, PERMISSION_DENIED: 1 }))
    expect(screen.getByRole('status')).toHaveTextContent(/couldn’t find you/)
    expect(screen.getByRole('button', { name: 'Stop tracking' })).toBeVisible()
    act(() => fail({ code: 1, PERMISSION_DENIED: 1 }))
    expect(screen.getByRole('status')).toHaveTextContent(/Allow location/)
    expect(track()).toBeVisible()
  })

  it('shares each usable reading with the form, and none once stopped (AC28)', () => {
    const onHere = vi.fn()
    render(<FindMyBlock pins={[near]} onHere={onHere} onBlock={vi.fn()} />)
    fireEvent.click(track())
    moveTo(HERE)
    expect(onHere).toHaveBeenLastCalledWith({ lat: 1.2966, lng: 103.852 })
    moveTo({ ...HERE, accuracy: 900 })
    expect(onHere).toHaveBeenLastCalledWith(null)
    moveTo(HERE)
    fireEvent.click(screen.getByRole('button', { name: 'Stop tracking' }))
    expect(onHere).toHaveBeenLastCalledWith(null)
  })

  it('widens the list when tracking ends by itself, or the picker closes (AC26)', () => {
    const onBlock = vi.fn()
    const view = render(<FindMyBlock pins={[near]} onHere={vi.fn()} onBlock={onBlock} />)
    fireEvent.click(track())
    moveTo(HERE)
    act(() => fail({ code: 1, PERMISSION_DENIED: 1 }))
    expect(onBlock).toHaveBeenLastCalledWith(null)
    fireEvent.click(track())
    moveTo(HERE)
    expect(onBlock).toHaveBeenLastCalledWith('Block A')
    view.unmount()
    expect(onBlock).toHaveBeenLastCalledWith(null)
  })
})
