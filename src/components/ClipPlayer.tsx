import { useEffect, useRef, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { Pause, Play, Volume2, VolumeX, Crop, Expand, Maximize2, ScanFace, X } from 'lucide-react'
import type { Clip } from '../lib/types'
import type { Fit } from '../lib/media'
import { fmt } from '../lib/format'
import type { Rect } from '../lib/facecam'
import { previewStyles } from '../lib/facecamLayout'

export interface PlayerHandle { seek: (t: number) => void; pause: () => void; duration: number }

/** 9:16 preview of one clip: the source file played between clip.start and clip.end (looping back to start),
 *  with play/pause, a clip-relative scrubber, time, mute, and the chosen fit mode shown as in the export. */
export default function ClipPlayer({ url, clip, fit, fc, onDuration, onTime, handle, onExpand, onClose, autoPlay, startAt }: {
  url: string; clip: Clip; fit: Fit; fc?: Rect | null
  onExpand?: () => void // shows an 'Enlarge preview' button
  onClose?: () => void // shows a close button (used in the enlarged view)
  autoPlay?: boolean; startAt?: number // enlarged view: begin playing from here
  onDuration?: (d: number) => void
  onTime?: (t: number) => void
  handle?: React.MutableRefObject<PlayerHandle | null>
}) {
  const vid = useRef<HTMLVideoElement>(null)
  const bg = useRef<HTMLVideoElement>(null) // blurred copy behind the video in 'blur' mode, kept in sync
  const firstStart = useRef(startAt !== undefined && startAt >= clip.start && startAt < clip.end ? startAt : clip.start)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [t, setT] = useState(firstStart.current)
  const [scrubbing, setScrubbing] = useState(false)
  const [aspect, setAspect] = useState(16 / 9)
  const fcs = fc ? previewStyles(fc, aspect) : null // facecam layout: the bg ref is the facecam copy of the video
  const len = clip.end - clip.start
  const rel = Math.max(0, Math.min(len, t - clip.start))

  useEffect(() => {
    if (!handle) return
    handle.current = {
      seek: (x: number) => { if (vid.current) { vid.current.currentTime = x; setT(x) } },
      pause: () => vid.current?.pause(),
      get duration() { return vid.current?.duration ?? NaN },
    }
    return () => { handle.current = null }
  }, [handle])

  const toggle = () => {
    const v = vid.current!
    if (!v.paused) return v.pause()
    if (v.currentTime < clip.start || v.currentTime >= clip.end - 0.1) v.currentTime = clip.start
    v.play().catch(() => {})
  }
  const sync = (v: HTMLVideoElement) => {
    const b = bg.current
    if (b && Math.abs(b.currentTime - v.currentTime) > 0.25) b.currentTime = v.currentTime
  }
  const seekRel = (r: number) => { if (vid.current) { vid.current.currentTime = clip.start + r; setT(clip.start + r) } }

  return (
    <div className="group relative isolate aspect-9/16 w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
      {(fit === 'blur' || fc) && (
        <video ref={bg} className={fc ? 'pointer-events-none' : 'pointer-events-none absolute inset-0 size-full scale-[1.4] object-cover blur-[22px]'} style={fcs?.cam}
          src={`${url}#t=${firstStart.current}`} muted preload="metadata" playsInline />
      )}
      <video
        ref={vid}
        className={fc ? undefined : `absolute inset-0 size-full ${fit === 'blur' ? 'object-contain' : 'object-cover'}`} style={fcs?.game}
        src={`${url}#t=${firstStart.current}`} preload="metadata" playsInline muted={muted}
        onLoadedMetadata={e => {
          onDuration?.(e.currentTarget.duration); setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight || 16 / 9)
          if (autoPlay) { e.currentTarget.currentTime = firstStart.current; e.currentTarget.play().catch(() => {}) }
        }}
        onPlay={() => { setPlaying(true); bg.current?.play().catch(() => {}) }}
        onPause={() => { setPlaying(false); bg.current?.pause() }}
        onSeeked={e => sync(e.currentTarget)}
        onTimeUpdate={e => {
          const v = e.currentTarget
          if (v.currentTime >= clip.end) { v.pause(); v.currentTime = clip.start } else sync(v)
          if (!scrubbing) { setT(v.currentTime); onTime?.(v.currentTime) }
        }}
      />

      {/* click target + big play badge */}
      <button
        type="button" onClick={toggle} aria-label={playing ? 'Pause preview' : 'Play preview'}
        className="absolute inset-0 grid place-items-center focus-visible:outline-offset-[-4px]"
      >
        <span className={`grid size-14 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/25 transition ${playing ? 'scale-75 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' : 'opacity-100'}`}>
          {playing ? <Pause className="size-6" fill="currentColor" /> : <Play className="size-6 translate-x-0.5" fill="currentColor" />}
        </span>
      </button>

      <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white/90 ring-1 ring-white/15">
        {fc ? <ScanFace className="size-3" aria-hidden /> : fit === 'blur' ? <Maximize2 className="size-3" aria-hidden /> : <Crop className="size-3" aria-hidden />}
        {fc ? 'Facecam stack' : fit === 'blur' ? 'Fit + blur' : 'Centre crop'}
      </span>

      <div className="absolute right-2 top-2 z-10 flex gap-1.5">
        {onExpand && (
          <button type="button" onClick={onExpand} aria-label="Enlarge preview" title="Enlarge preview"
            className="grid size-8 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/20 transition hover:bg-black/75">
            <Expand className="size-4" />
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close enlarged preview" title="Close"
            className="grid size-8 place-items-center rounded-full bg-black/55 text-white ring-1 ring-white/20 transition hover:bg-black/75">
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* controls */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 bg-linear-to-t from-black/85 via-black/50 to-transparent px-3 pb-2 pt-8">
        <Slider.Root
          className="relative flex h-4 w-full touch-none select-none items-center"
          min={0} max={Math.max(0.1, len)} step={0.05} value={[rel]}
          onValueChange={([v]) => { setScrubbing(true); seekRel(v) }}
          onValueCommit={() => setScrubbing(false)}
        >
          <Slider.Track className="relative h-1 grow rounded-full bg-white/25 transition-[height] group-hover:h-1.5">
            <Slider.Range className="absolute h-full rounded-full bg-white" />
          </Slider.Track>
          <Slider.Thumb aria-label="Seek within clip" aria-valuetext={`${fmt(rel)} of ${fmt(len)}`}
            className="block size-3 rounded-full bg-white shadow ring-2 ring-violet-400/0 transition hover:scale-125 focus-visible:ring-violet-400" />
        </Slider.Root>
        <div className="flex items-center justify-between text-[11px] tabular-nums text-white/85">
          <span>{fmt(rel)} / {fmt(len)}</span>
          <button
            type="button" onClick={() => setMuted(m => !m)} aria-pressed={muted} aria-label={muted ? 'Unmute' : 'Mute'}
            className="grid size-7 place-items-center rounded-full hover:bg-white/15"
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}
