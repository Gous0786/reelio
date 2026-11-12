import { AudioLines, Check, HardDriveDownload, PauseCircle, Sparkles, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { Progress } from './ui'
import { Anim } from './Illustrations'
import BorderBeam from './vengeance/BorderBeam'
import { dur } from '../lib/format'

export type Stage = 'idle' | 'model' | 'transcribe' | 'clips' | 'done' | 'error'

/** Live numbers for the progress view. Set by App next to the status string; null = not known (yet). */
export interface RunInfo {
  model: string | null; device: string | null; gpu: string | null; workers: number | null
  pct: number | null; elapsed: number | null; left: number | null; speed: number | null
  download: number | null
  subs: string | null // set when the transcript comes from subtitles (e.g. 'English · SRT · 2,436 cues')
}
export const NO_INFO: RunInfo = { model: null, device: null, gpu: null, workers: null, pct: null, elapsed: null, left: null, speed: null, download: null, subs: null }

const STEPS: { id: Stage; label: string; title: string; Icon: LucideIcon }[] = [
  { id: 'model', label: 'Speech model', title: 'Warming up the speech model', Icon: HardDriveDownload },
  { id: 'transcribe', label: 'Transcribe', title: 'Listening to every second', Icon: AudioLines },
  { id: 'clips', label: 'Find clips', title: 'Picking the best moments', Icon: Sparkles },
]
const SUBS_STEPS: Record<number, { label: string; title: string }> = {
  0: { label: 'Subtitles', title: 'Reading the subtitles' },
  1: { label: 'Loudness', title: 'Measuring the audio' },
}
const BARS = Array.from({ length: 72 }, (_, i) => 0.18 + 0.82 * Math.abs(Math.sin(i * 0.9) * Math.sin(i * 0.23 + 1)))

function Tile({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={clsx('inset min-w-0 px-3.5 py-3', wide && 'col-span-2')}>
      <p className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">{label}</p>
      <p className="font-display mt-0.5 truncate text-lg leading-tight font-bold text-fg tabular-nums" title={value}>{value}</p>
    </div>
  )
}

export default function ProgressView({ stage, status, info }: { stage: Stage; status: string; info: RunInfo }) {
  const cur = Math.max(0, STEPS.findIndex(s => s.id === stage))
  const bar = stage === 'transcribe' ? info.pct : stage === 'model' ? info.download : null
  const dash = '—'
  const subs = info.subs !== null // subtitles replace the speech model + transcription steps
  const step = subs ? { ...STEPS[cur], ...(SUBS_STEPS[cur] ?? {}) } : STEPS[cur]
  return (
    <section className="slab overflow-hidden p-5 sm:p-7" aria-live="polite" aria-label="Processing progress">
      <div className="flex items-center gap-4">
        <Anim name={stage === 'clips' ? 'sparkles' : 'hourglass'} className="size-14 sm:size-18" />
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Step {cur + 1} of 3</p>
          <h2 className="font-display text-2xl leading-tight font-bold text-fg uppercase sm:text-3xl">{step.title}</h2>
        </div>
        {bar !== null && (
          <p className="font-display shrink-0 text-5xl leading-none font-bold text-accent tabular-nums sm:text-6xl">
            {bar}<span className="text-2xl text-muted sm:text-3xl">%</span>
          </p>
        )}
      </div>

      <ol className="mt-6 grid grid-cols-3 gap-2">
        {STEPS.map(({ id, label: l0, Icon }, i) => {
          const label = subs ? (SUBS_STEPS[i]?.label ?? l0) : l0
          const state = i < cur ? 'done' : i === cur ? 'active' : 'todo'
          return (
            <li key={id} aria-current={state === 'active' ? 'step' : undefined}
              className={clsx('relative flex items-center gap-2.5 rounded-2xl border-2 px-2.5 py-2.5 sm:px-3.5',
                state === 'active' && 'border-accent bg-accent/12 text-fg',
                state === 'done' && 'border-good/40 bg-good/8 text-fg',
                state === 'todo' && 'border-line text-muted')}>
              {state === 'active' && <BorderBeam size={90} duration={3.5} />}
              <span className={clsx('grid size-8 shrink-0 place-items-center rounded-full',
                state === 'active' ? 'bg-accent text-on-accent' : state === 'done' ? 'bg-good text-base' : 'bg-fg/8')}>
                {state === 'done' ? <Check className="size-4" strokeWidth={3} /> : <Icon className="size-4" />}
              </span>
              <span className="truncate text-xs font-bold sm:text-sm">{label}<span className="sr-only">{state === 'done' ? ' (done)' : state === 'active' ? ' (in progress)' : ''}</span></span>
            </li>
          )
        })}
      </ol>

      <div className="mt-5">
        {bar === null
          ? <Progress value={null} label={step.title} />
          : (
            <div role="progressbar" aria-label={step.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={bar}
              className="inset flex h-16 items-center gap-[2px] px-3 sm:gap-[3px]">
              {BARS.map((h, i) => (
                <span key={i} className={clsx('w-full rounded-full transition-colors duration-300', (i + 0.5) / BARS.length * 100 <= bar ? 'bg-accent' : 'bg-fg/15')}
                  style={{ height: `${h * 80}%` }} />
              ))}
            </div>
          )}
        <p className="mt-2.5 text-[13px] leading-relaxed break-words text-muted">{status}</p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Model" value={info.model ?? dash} />
        <Tile label="Workers" value={info.workers ? String(info.workers) : dash} />
        <Tile wide label="Device" value={info.device ? `${info.device}${info.gpu ? ` · ${info.gpu}` : ''}` : dash} />
        <Tile label="Speed" value={info.speed ? `${info.speed.toFixed(1)}×` : dash} />
        <Tile label="Elapsed" value={info.elapsed !== null ? dur(info.elapsed) : dash} />
        <Tile wide label="Time left" value={info.left !== null && info.speed ? `~${dur(info.left)}` : dash} />
      </div>
      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted"><PauseCircle className="size-3.5" aria-hidden />The animated backdrop is paused while the GPU is busy.</p>
    </section>
  )
}
