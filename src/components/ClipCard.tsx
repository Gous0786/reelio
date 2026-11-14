import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Clock, Copy, Download, Film, Loader2 } from 'lucide-react'
import type { Clip } from '../lib/types'
import { exportClip, type Fit } from '../lib/media'
import type { Rect } from '../lib/facecam'
import type { CaptionConfig } from '../lib/captions'
import { fmt, outName, save } from '../lib/format'
import ClipPlayer, { type PlayerHandle } from './ClipPlayer'
import TrimSlider from './TrimSlider'
import { RankBreakdown } from './RankBreakdown'
import { Alert, Button, Chip } from './ui'

/** Ring gauge for the 0-100 clip score. */
function ScoreRing({ score }: { score: number }) {
  const r = 22, c = 2 * Math.PI * r
  return (
    <span className="relative grid size-14 shrink-0 place-items-center" role="img" aria-label={`Score ${score} out of 100`}>
      <svg viewBox="0 0 52 52" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="26" cy="26" r={r} fill="none" strokeWidth="5" className="stroke-fg/12" />
        <circle cx="26" cy="26" r={r} fill="none" strokeWidth="5" strokeLinecap="round"
          className={score >= 80 ? 'stroke-accent' : score >= 60 ? 'stroke-zing' : 'stroke-hot'}
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, score)) / 100)} />
      </svg>
      <span className="font-display text-lg leading-none font-bold text-fg tabular-nums">{score}</span>
    </span>
  )
}

export default function ClipCard({ rank, clip, file, url, fit, fc, captions, ensureCaptions, locked, onTrim, onRendering }: {
  rank: number; clip: Clip; file: File; url: string; fit: Fit; fc: Rect | null; captions: CaptionConfig | null; locked: boolean
  ensureCaptions: (start: number, end: number) => Promise<CaptionConfig | null> // captions with this range's words timed
  onTrim: (t: { start: number; end: number }) => void
  onRendering: (active: boolean) => void
}) {
  const player = useRef<PlayerHandle | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [dur, setDur] = useState(NaN) // source duration, from the player's metadata
  const [playhead, setPlayhead] = useState<number | null>(null)
  const [full, setFull] = useState(false) // enlarged preview open
  const [saved, setSaved] = useState(false) // brief 'Saved' state after a download
  const orig = useRef({ start: clip.start, end: clip.end })
  const rendering = useRef(false)
  const setRendering = (a: boolean) => { rendering.current = a; onRendering(a) }
  useEffect(() => () => { if (rendering.current) onRendering(false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Mini-timeline window: the clip plus some context either side, anchored on the clip as first found so that
  // dragging a handle never rescales the track under the pointer. It only grows if a nudge leaves it.
  const pad = Math.min(30, Math.max(10, (orig.current.end - orig.current.start) * 0.6))
  const top = Number.isFinite(dur) ? dur : Infinity
  const bounds: [number, number] = [
    Math.max(0, Math.min(orig.current.start - pad, clip.start)),
    Math.min(top, Math.max(orig.current.end + pad, clip.end)),
  ]

  const seekEdge = (which: 'start' | 'end', t: { start: number; end: number }) =>
    player.current?.seek(which === 'start' ? t.start : Math.max(t.start, t.end - 2)) // show the edited edge
  const nudge = (which: 'start' | 'end', d: number) => {
    const max = Number.isFinite(dur) ? dur : Infinity
    let { start, end } = clip
    if (which === 'start') start = Math.max(0, Math.min(start + d, end - 1))
    else end = Math.min(max, Math.max(end + d, start + 1))
    start = +start.toFixed(2); end = +end.toFixed(2)
    onTrim({ start, end })
    seekEdge(which, { start, end })
  }
  const download = async () => {
    setErr(''); setPct(0); setRendering(true)
    try { const cap = captions && await ensureCaptions(clip.start, clip.end); save(await exportClip(file, clip.start, clip.end, fit, setPct, fc, cap), outName(file, rank)); setSaved(true); setTimeout(() => setSaved(false), 2500) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setPct(null); setRendering(false)
  }
  const copy = async () => {
    await navigator.clipboard.writeText([clip.caption, clip.hashtags?.join(' ')].filter(Boolean).join('\n\n'))
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  const score = Math.round(clip.score)

  return (
    <article id={`clip-${rank}`} tabIndex={-1} className="@container slab scroll-mt-6 overflow-hidden outline-none focus-visible:outline-3 focus-visible:outline-zing" aria-label={`Clip ${rank}: ${clip.title}`}>
      <div className="flex flex-col gap-5 p-4 @lg:flex-row @lg:p-5">
        <div className="mx-auto w-full max-w-64 shrink-0 @lg:mx-0 @lg:w-52">
          {/* phone bezel */}
          <div className="relative rounded-[1.9rem] border-[7px] border-bezel bg-bezel shadow-xl">
            <span aria-hidden className="absolute top-1.5 left-1/2 z-20 h-1.5 w-12 -translate-x-1/2 rounded-full bg-bezel/90" />
            <ClipPlayer url={url} clip={clip} fit={fit} fc={fc} captions={captions} handle={player} onDuration={setDur} onTime={setPlayhead}
              onExpand={() => { player.current?.pause(); setFull(true) }} />
          </div>
          <Dialog.Root open={full} onOpenChange={setFull}>
            <Dialog.Portal>
              <Dialog.Overlay className="animate-overlay-in fixed inset-0 z-40 bg-black/60 backdrop-blur-2xl" />
              <Dialog.Content aria-describedby={undefined} className="animate-overlay-in fixed top-1/2 left-1/2 z-50 w-[min(94vw,calc(88vh*9/16))] -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border-8 border-bezel bg-bezel shadow-2xl focus:outline-none">
                <Dialog.Title className="sr-only">Preview of clip {rank}: {clip.title}</Dialog.Title>
                <ClipPlayer url={url} clip={clip} fit={fit} fc={fc} captions={captions} autoPlay startAt={playhead ?? undefined} onClose={() => setFull(false)} />
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3.5">
          <div className="flex items-center gap-3">
            <span className="font-display text-5xl leading-none font-bold text-transparent tabular-nums [-webkit-text-stroke:2px_var(--fg)]" aria-hidden>
              {String(rank).padStart(2, '0')}
            </span>
            <ScoreRing score={score} />
            <div className="ml-auto flex flex-col items-end gap-1">
              <Chip tone="accent"><Clock className="size-3" aria-hidden />{(clip.end - clip.start).toFixed(1)}s</Chip>
              <Chip><Film className="size-3" aria-hidden /><span className="tabular-nums">{fmt(clip.start)}–{fmt(clip.end)}</span></Chip>
            </div>
          </div>

          <div>
            <h3 className="font-display text-xl leading-snug font-bold text-fg">{clip.title}</h3>
            <blockquote className="mt-2 border-l-4 border-hot pl-3 text-[15px] leading-snug font-medium text-fg">“{clip.hook}”</blockquote>
            <p className="mt-2 text-[13px] leading-relaxed text-muted">{clip.reason}</p>
          </div>

          {clip.rank && <RankBreakdown rank={clip.rank} />}

          <TrimSlider
            start={clip.start} end={clip.end} bounds={bounds} playhead={playhead}
            onChange={(t, moved) => { onTrim(t); seekEdge(moved, t) }}
            onCommit={() => {}}
            onNudge={nudge}
          />

          {(clip.caption || clip.hashtags?.length) && (
            <div className="inset p-3.5 text-[13px]">
              {clip.caption && <p className="text-fg">{clip.caption}</p>}
              {clip.hashtags?.length ? (
                <p className="mt-2 flex flex-wrap gap-1.5">{clip.hashtags.map(h => <span key={h} className="rounded-full bg-hot/12 px-2 py-0.5 text-xs font-semibold text-hot">{h}</span>)}</p>
              ) : null}
              <Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={copy}
                icon={copied ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}>
                {copied ? 'Copied' : 'Copy caption'}
              </Button>
              <span className="sr-only" role="status">{copied ? 'Caption copied to clipboard' : ''}</span>
            </div>
          )}

          <div className="mt-auto flex flex-col gap-2 pt-1">
            <Button variant="primary" size="lg" disabled={pct !== null || locked} onClick={download} className="overflow-hidden"
              aria-label={pct !== null ? `Rendering clip ${rank}, ${pct}%` : saved ? `Clip ${rank} saved` : `Download clip ${rank} as MP4`}>
              {pct !== null && <span aria-hidden className="absolute inset-y-0 left-0 bg-on-accent/20 transition-[width] duration-300" style={{ width: `${pct}%` }} />}
              <span className="relative inline-flex items-center gap-2">
                {pct !== null ? <Loader2 className="size-5 animate-spin" /> : saved ? <Check className="size-5" strokeWidth={3} /> : <Download className="size-5" />}
                {pct !== null ? `Rendering… ${pct}%` : saved ? 'Saved to downloads' : 'Download MP4'}
              </span>
            </Button>
            <span className="sr-only" role="status">{saved ? `Clip ${rank} saved` : ''}</span>
            {err && <Alert tone="error">{err}</Alert>}
          </div>
        </div>
      </div>
    </article>
  )
}
