import { useRef } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Scissors } from 'lucide-react'
import { fmt1 } from '../lib/format'
import { IconButton } from './ui'

const MIN_LEN = 1 // seconds, same floor the nudge buttons always enforced

/** Dual-handle trim control on a mini timeline of the source around the clip. `bounds` is the visible window
 *  (seconds in the source), `playhead` the current preview time. Fine nudge buttons sit under each handle. */
export default function TrimSlider({ start, end, bounds, playhead, onChange, onNudge, onCommit }: {
  start: number; end: number; bounds: [number, number]; playhead: number | null
  onChange: (t: { start: number; end: number }, moved: 'start' | 'end') => void
  onNudge: (which: 'start' | 'end', delta: number) => void
  onCommit: (moved: 'start' | 'end') => void
}) {
  const [lo, hi] = bounds
  const span = Math.max(1, hi - lo)
  const pos = (v: number) => `${((v - lo) / span) * 100}%`
  const dragged = useRef<'start' | 'end'>('start')
  const thumb = 'group/t relative block h-14 w-4 rounded-lg border-2 border-edge bg-accent shadow-lg outline-none transition-transform hover:scale-y-105 focus-visible:ring-4 focus-visible:ring-zing'

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-xs text-muted">
        <span className="font-display flex items-center gap-1.5 text-sm font-bold text-fg"><Scissors className="size-3.5 text-hot" aria-hidden />Trim</span>
        <span className="tabular-nums"><span className="font-display text-base font-bold text-fg">{(end - start).toFixed(1)}s</span> selected</span>
      </div>

      <Slider.Root
        className="relative flex h-16 w-full touch-none select-none items-center"
        min={lo} max={hi} step={0.1} minStepsBetweenThumbs={MIN_LEN * 10}
        value={[start, end]}
        onValueChange={([s, e]) => {
          const moved = Math.abs(s - start) > 1e-6 ? 'start' : 'end'
          dragged.current = moved
          onChange({ start: +s.toFixed(2), end: +e.toFixed(2) }, moved)
        }}
        onValueCommit={() => onCommit(dragged.current)}
      >
        {/* film strip: sprocket rows around a row of frame cells */}
        <Slider.Track className="relative h-12 grow overflow-hidden rounded-xl bg-bezel">
          <span aria-hidden className="sprockets absolute inset-x-1 top-1 h-1.5 opacity-60 [background-image:radial-gradient(circle,var(--raised)_0_1.6px,transparent_2px)]" />
          <span aria-hidden className="sprockets absolute inset-x-1 bottom-1 h-1.5 opacity-60 [background-image:radial-gradient(circle,var(--raised)_0_1.6px,transparent_2px)]" />
          <span aria-hidden className="absolute inset-x-0 inset-y-3 bg-[repeating-linear-gradient(90deg,var(--raised)_0_22px,var(--bezel)_22px_24px)] opacity-90" />
          <Slider.Range className="absolute h-full border-y-[3px] border-accent bg-accent/25" />
        </Slider.Track>
        {playhead !== null && playhead >= lo && playhead <= hi && (
          <span aria-hidden className="pointer-events-none absolute top-0 h-16 w-0.5 -translate-x-1/2 rounded bg-hot" style={{ left: pos(playhead) }}>
            <span className="absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-hot" />
          </span>
        )}
        <Slider.Thumb aria-label="Clip start" aria-valuetext={fmt1(start)} className={thumb}>
          <span aria-hidden className="absolute inset-y-4 left-1/2 w-0.5 -translate-x-1/2 rounded bg-on-accent/60" />
        </Slider.Thumb>
        <Slider.Thumb aria-label="Clip end" aria-valuetext={fmt1(end)} className={thumb}>
          <span aria-hidden className="absolute inset-y-4 left-1/2 w-0.5 -translate-x-1/2 rounded bg-on-accent/60" />
        </Slider.Thumb>
      </Slider.Root>

      <div className="flex justify-between text-[11px] text-muted tabular-nums" aria-hidden>
        <span>{fmt1(lo)}</span><span>{fmt1(hi)}</span>
      </div>

      <div className="grid gap-1.5">
        <Nudge label="Start" value={start} onNudge={d => onNudge('start', d)} />
        <Nudge label="End" value={end} onNudge={d => onNudge('end', d)} />
      </div>
    </div>
  )
}

function Nudge({ label, value, onNudge }: { label: string; value: number; onNudge: (d: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-0.5 rounded-full border border-line bg-raised px-1 py-0.5">
      <IconButton size="sm" label={`${label} −0.5 s`} onClick={() => onNudge(-0.5)} className="size-7"><ChevronsLeft className="size-4" /></IconButton>
      <IconButton size="sm" label={`${label} −0.1 s`} onClick={() => onNudge(-0.1)} className="size-7"><ChevronLeft className="size-4" /></IconButton>
      <span className="flex min-w-0 items-baseline gap-1.5 px-1 text-center">
        <span className="text-[10px] font-bold tracking-[0.14em] text-muted uppercase">{label}</span>
        <span className="text-sm font-semibold text-fg tabular-nums">{fmt1(value)}</span>
      </span>
      <IconButton size="sm" label={`${label} +0.1 s`} onClick={() => onNudge(0.1)} className="size-7"><ChevronRight className="size-4" /></IconButton>
      <IconButton size="sm" label={`${label} +0.5 s`} onClick={() => onNudge(0.5)} className="size-7"><ChevronsRight className="size-4" /></IconButton>
    </div>
  )
}
