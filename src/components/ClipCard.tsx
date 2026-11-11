import { useEffect, useRef, useState } from 'react'
import { Check, Clock, Copy, Download, Loader2, Quote } from 'lucide-react'
import type { Clip } from '../lib/types'
import { exportClip, type Fit } from '../lib/media'
import type { Rect } from '../lib/facecam'
import { outName, save } from '../lib/format'
import ClipPlayer, { type PlayerHandle } from './ClipPlayer'
import TrimSlider from './TrimSlider'
import { RankBreakdown } from './RankBreakdown'
import { Alert, Button, Chip, Progress, card } from './ui'

export default function ClipCard({ rank, clip, file, url, fit, fc, locked, onTrim, onRendering }: {
  rank: number; clip: Clip; file: File; url: string; fit: Fit; fc: Rect | null; locked: boolean
  onTrim: (t: { start: number; end: number }) => void
  onRendering: (active: boolean) => void
}) {
  const player = useRef<PlayerHandle | null>(null)
  const [pct, setPct] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)
  const [dur, setDur] = useState(NaN) // source duration, from the player's metadata
  const [playhead, setPlayhead] = useState<number | null>(null)
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
    try { save(await exportClip(file, clip.start, clip.end, fit, setPct, fc), outName(file, rank)) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setPct(null); setRendering(false)
  }
  const copy = async () => {
    await navigator.clipboard.writeText([clip.caption, clip.hashtags?.join(' ')].filter(Boolean).join('\n\n'))
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  const score = Math.round(clip.score)
  const tone = score >= 80 ? 'good' : score >= 60 ? 'accent' : 'neutral'

  return (
    <article className={`@container ${card} overflow-hidden`} aria-label={`Clip ${rank}: ${clip.title}`}>
      <div className="flex flex-col gap-5 p-4 @lg:flex-row @lg:p-5">
        <div className="mx-auto w-full max-w-65 shrink-0 @lg:mx-0 @lg:w-47.5">
          <ClipPlayer url={url} clip={clip} fit={fit} fc={fc} handle={player} onDuration={setDur} onTime={setPlayhead} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-display grid size-8 place-items-center rounded-full bg-white/8 text-sm font-semibold text-zinc-200 ring-1 ring-white/10">#{rank}</span>
            <Chip tone={tone} className="font-display text-sm"><span className="tabular-nums font-semibold">{score}</span><span className="text-[11px] opacity-70">score</span></Chip>
            <Chip><Clock className="size-3" aria-hidden />{(clip.end - clip.start).toFixed(1)}s</Chip>
          </div>

          <div>
            <h3 className="font-display text-lg leading-snug font-semibold text-white">{clip.title}</h3>
            <p className="mt-1 flex gap-1.5 text-sm text-zinc-200 italic"><Quote className="mt-0.5 size-3.5 shrink-0 text-violet-300" aria-hidden /><span>{clip.hook}</span></p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{clip.reason}</p>
          </div>

          {clip.rank && <RankBreakdown rank={clip.rank} />}

          <TrimSlider
            start={clip.start} end={clip.end} bounds={bounds} playhead={playhead}
            onChange={(t, moved) => { onTrim(t); seekEdge(moved, t) }}
            onCommit={() => {}}
            onNudge={nudge}
          />

          {(clip.caption || clip.hashtags?.length) && (
            <div className="rounded-2xl border border-white/10 bg-white/4 p-3 text-[13px]">
              {clip.caption && <p className="text-zinc-200">{clip.caption}</p>}
              {clip.hashtags?.length ? <p className="mt-1 text-violet-300">{clip.hashtags.join(' ')}</p> : null}
              <Button size="sm" variant="ghost" className="mt-2 -ml-2" onClick={copy}
                icon={copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}>
                {copied ? 'Copied' : 'Copy caption'}
              </Button>
              <span className="sr-only" role="status">{copied ? 'Caption copied to clipboard' : ''}</span>
            </div>
          )}

          <div className="mt-auto flex flex-col gap-2 pt-1">
            {pct !== null && <Progress value={pct} />}
            <Button variant="primary" disabled={pct !== null || locked} onClick={download}
              icon={pct === null ? <Download className="size-4" /> : <Loader2 className="size-4 animate-spin" />}>
              {pct === null ? 'Download MP4' : `Rendering… ${pct}%`}
            </Button>
            {err && <Alert tone="error">{err}</Alert>}
          </div>
        </div>
      </div>
    </article>
  )
}
