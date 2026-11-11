import { useRef } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
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

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between text-xs text-zinc-400">
        <span className="font-medium text-zinc-200">Trim</span>
        <span className="tabular-nums">{(end - start).toFixed(1)}s selected</span>
      </div>

      <Slider.Root
        className="relative flex h-10 w-full touch-none select-none items-center"
        min={lo} max={hi} step={0.1} minStepsBetweenThumbs={MIN_LEN * 10}
        value={[start, end]}
        onValueChange={([s, e]) => {
          const moved = Math.abs(s - start) > 1e-6 ? 'start' : 'end'
          dragged.current = moved
          onChange({ start: +s.toFixed(2), end: +e.toFixed(2) }, moved)
        }}
        onValueCommit={() => onCommit(dragged.current)}
      >
        {/* tick ruler */}
        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex h-2 justify-between px-1">
          {Array.from({ length: 21 }, (_, i) => <span key={i} className={`w-px ${i % 5 === 0 ? 'h-2 bg-white/30' : 'h-1 bg-white/15'}`} />)}
        </div>
        <Slider.Track className="relative h-6 grow overflow-hidden rounded-lg bg-white/8 ring-1 ring-white/10">
          <Slider.Range className="absolute h-full rounded-md bg-violet-500/35 ring-1 ring-inset ring-violet-400/70" />
        </Slider.Track>
        {playhead !== null && playhead >= lo && playhead <= hi && (
          <span aria-hidden className="pointer-events-none absolute top-1 h-8 w-0.5 -translate-x-1/2 rounded bg-white/90" style={{ left: pos(playhead) }} />
        )}
        <Slider.Thumb
          aria-label="Clip start" aria-valuetext={fmt1(start)}
          className="block h-8 w-3.5 rounded-md bg-white shadow-lg ring-2 ring-violet-500 transition hover:scale-y-110 focus-visible:ring-4 focus-visible:ring-violet-300"
        />
        <Slider.Thumb
          aria-label="Clip end" aria-valuetext={fmt1(end)}
          className="block h-8 w-3.5 rounded-md bg-white shadow-lg ring-2 ring-fuchsia-500 transition hover:scale-y-110 focus-visible:ring-4 focus-visible:ring-fuchsia-300"
        />
      </Slider.Root>

      <div className="-mt-1 flex justify-between text-[11px] tabular-nums text-zinc-500" aria-hidden>
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
    <div className="flex items-center justify-between gap-1 rounded-full border border-white/10 bg-white/4 px-1 py-0.5">
      <IconButton size="sm" label={`${label} −0.5 s`} onClick={() => onNudge(-0.5)} className="size-7"><ChevronsLeft className="size-4" /></IconButton>
      <IconButton size="sm" label={`${label} −0.1 s`} onClick={() => onNudge(-0.1)} className="size-7"><ChevronLeft className="size-4" /></IconButton>
      <span className="flex min-w-0 items-baseline gap-2 px-1 text-center">
        <span className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</span>
        <span className="text-sm font-medium tabular-nums text-zinc-100">{fmt1(value)}</span>
      </span>
      <IconButton size="sm" label={`${label} +0.1 s`} onClick={() => onNudge(0.1)} className="size-7"><ChevronRight className="size-4" /></IconButton>
      <IconButton size="sm" label={`${label} +0.5 s`} onClick={() => onNudge(0.5)} className="size-7"><ChevronsRight className="size-4" /></IconButton>
    </div>
  )
}
