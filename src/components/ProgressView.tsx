import { AudioLines, Check, Cpu, Gauge, HardDriveDownload, Hourglass, Layers, Sparkles, Timer, type LucideIcon } from 'lucide-react'
import clsx from 'clsx'
import { Loader2 } from 'lucide-react'
import { Progress, card } from './ui'
import { dur } from '../lib/format'

export type Stage = 'idle' | 'model' | 'transcribe' | 'clips' | 'done' | 'error'

/** Live numbers for the progress view. Set by App next to the status string; null = not known (yet). */
export interface RunInfo {
  model: string | null; device: string | null; gpu: string | null; workers: number | null
  pct: number | null; elapsed: number | null; left: number | null; speed: number | null
  download: number | null
}
export const NO_INFO: RunInfo = { model: null, device: null, gpu: null, workers: null, pct: null, elapsed: null, left: null, speed: null, download: null }

const STEPS: { id: Stage; label: string; Icon: LucideIcon }[] = [
  { id: 'model', label: 'Loading speech model', Icon: HardDriveDownload },
  { id: 'transcribe', label: 'Extracting audio & transcribing', Icon: AudioLines },
  { id: 'clips', label: 'Finding clips', Icon: Sparkles },
]

function Stat({ Icon, label, value, wide }: { Icon: LucideIcon; label: string; value: string; wide?: boolean }) {
  return (
    <div className={clsx('flex min-w-0 items-center gap-3 rounded-2xl border border-white/10 bg-white/4 px-3 py-2.5', wide && 'col-span-2 lg:col-span-1')}>
      <Icon className="size-4 shrink-0 text-violet-300" aria-hidden />
      <div className="min-w-0">
        <p className="text-[11px] tracking-wide text-zinc-400 uppercase">{label}</p>
        <p className="truncate text-sm font-medium text-zinc-100 tabular-nums" title={value}>{value}</p>
      </div>
    </div>
  )
}

export default function ProgressView({ stage, status, info }: { stage: Stage; status: string; info: RunInfo }) {
  const cur = STEPS.findIndex(s => s.id === stage)
  const bar = stage === 'transcribe' ? info.pct : stage === 'model' ? info.download : null
  const dash = '—'
  return (
    <section className={clsx(card, 'p-5 sm:p-6')} aria-live="polite" aria-label="Processing progress">
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map(({ id, label, Icon }, i) => {
          const state = i < cur ? 'done' : i === cur ? 'active' : 'todo'
          return (
            <li key={id} aria-current={state === 'active' ? 'step' : undefined}
              className={clsx('flex items-center gap-3 rounded-2xl border px-3.5 py-3 transition',
                state === 'active' && 'border-violet-400/60 bg-violet-500/10 text-white',
                state === 'done' && 'border-emerald-400/30 bg-emerald-500/8 text-emerald-100',
                state === 'todo' && 'border-white/10 bg-white/3 text-zinc-400')}>
              <span className={clsx('grid size-9 shrink-0 place-items-center rounded-full',
                state === 'active' ? 'bg-violet-500 text-white' : state === 'done' ? 'bg-emerald-500/25 text-emerald-200' : 'bg-white/8')}>
                {state === 'done' ? <Check className="size-4" /> : state === 'active' ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
              </span>
              <span className="text-sm leading-tight font-medium">{label}<span className="sr-only">{state === 'done' ? ' (done)' : state === 'active' ? ' (in progress)' : ''}</span></span>
            </li>
          )
        })}
      </ol>

      <div className="mt-5 flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p className="min-w-0 text-zinc-200">{status}</p>
          {bar !== null && <span className="font-display shrink-0 text-lg font-semibold text-white tabular-nums">{bar}%</span>}
        </div>
        <Progress value={bar} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-3">
        <Stat Icon={Layers} label="Model" value={info.model ?? dash} />
        <Stat wide Icon={Cpu} label="Device" value={info.device ? `${info.device}${info.gpu ? ` · ${info.gpu}` : ''}` : dash} />
        <Stat Icon={Layers} label="Workers" value={info.workers ? String(info.workers) : dash} />
        <Stat Icon={Gauge} label="Speed" value={info.speed ? `${info.speed.toFixed(1)}× realtime` : dash} />
        <Stat Icon={Timer} label="Elapsed" value={info.elapsed !== null ? dur(info.elapsed) : dash} />
        <Stat Icon={Hourglass} label="Time left" value={info.left !== null && info.speed ? `~${dur(info.left)}` : dash} />
      </div>
      <p className="mt-4 text-xs text-zinc-400">The animated backdrop is paused while the GPU is busy.</p>
    </section>
  )
}
