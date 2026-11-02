// The camera during a site walk (CP-22 AC3): the walk stream's live video full
// screen while the recording keeps running. Used by the Recording screen,
// which stamps and keeps each photo; stills come from recorder.ts's grabStill.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../../../design-system'
import { grabStill } from '../recorder'

// Takes still photos from the walk’s live camera stream.
export function CameraView({
  stream,
  status,
  onShot,
  onClose,
}: {
  stream: MediaStream | null
  // The recording pill's text, e.g. "07:40", or null when not recording.
  status: string | null
  onShot: (photo: Blob) => void
  onClose: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [last, setLast] = useState<string | null>(null)
  const [flash, setFlash] = useState(0)
  const hasCamera = !!stream?.getVideoTracks().some((t) => t.readyState !== 'ended')

  useEffect(() => {
    if (video.current && hasCamera) video.current.srcObject = stream
  }, [stream, hasCamera])
  // Frees the last thumbnail's memory when it is replaced or the camera closes.
  useEffect(() => () => void (last && URL.revokeObjectURL(last)), [last])

  async function shoot() {
    if (!video.current) return
    const photo = await grabStill(video.current)
    if (!photo) return
    // Kept first, so a failing thumbnail can never lose the photo.
    onShot(photo)
    setFlash((n) => n + 1)
    setLast(URL.createObjectURL(photo))
  }

  return (
    <div className="sw-camera" role="dialog" aria-modal="true" aria-label="Camera">
      {hasCamera ? (
        <video ref={video} autoPlay playsInline muted aria-label="Live camera view" />
      ) : (
        <p className="sw-camera-none">No camera is available on this device.</p>
      )}
      {flash > 0 && <div key={flash} className="sw-camera-flash" aria-hidden="true" />}
      <div className="sw-camera-top">
        {status && (
          <span className="sw-rec-pill" role="status">
            <span className="sw-rec-dot" aria-hidden="true" />
            {status} · still recording
          </span>
        )}
      </div>
      <div className="sw-camera-bottom">
        <span className="sw-camera-thumb">{last && <img src={last} alt="Last photo taken" />}</span>
        <button
          type="button"
          className="sw-shutter"
          aria-label="Take photo"
          disabled={!hasCamera}
          onClick={() => void shoot()}
        />
        <button type="button" className="sw-button sw-camera-done" onClick={onClose}>
          <Icon name="check" size={16} />
          Done
        </button>
      </div>
    </div>
  )
}
