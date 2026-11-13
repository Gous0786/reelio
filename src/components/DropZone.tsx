import { useRef, useState } from 'react'
import { FileVideo, Lock, Star, Play, Scissors, Upload, Wand2 } from 'lucide-react'
import clsx from 'clsx'
import { Anim } from './Illustrations'
import BorderBeam from './vengeance/BorderBeam'
import { Button } from './ui'
import { isSidecar } from '../lib/subtitles'

const STEPS = [
  { Icon: Lock, title: 'Transcribed on your device', text: 'Whisper runs in the browser. The video never leaves.' },
  { Icon: Wand2, title: 'Ranked by an LLM', text: 'Moments scored on hook, arc, pacing and more.' },
  { Icon: Scissors, title: 'Trim, frame, export', text: 'Nudge the cut and download a 9:16 MP4.' },
]
const BARS = Array.from({ length: 48 }, (_, i) => 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.37)))

/** Decorative fanned stack of vertical clips over a source timeline. */
function ClipStack({ over }: { over: boolean }) {
  const cards = [
    { rot: -9, x: '-58%', tint: 'var(--hot)', z: 1 },
    { rot: 8, x: '58%', tint: 'var(--zing)', z: 1 },
    { rot: 0, x: '0%', tint: 'var(--accent)', z: 2 },
  ]
  return (
    <div aria-hidden className="relative mx-auto h-64 w-full max-w-sm sm:h-80">
      {cards.map((c, i) => (
        <div key={i}
          className="absolute top-2 left-1/2 aspect-9/16 h-[82%] rounded-[1.4rem] border-[5px] border-bezel bg-bezel shadow-2xl transition-transform duration-500 ease-out group-hover/drop:duration-300"
          style={{ zIndex: c.z, transform: `translateX(calc(-50% + ${over ? `calc(${c.x} * 1.25)` : c.x})) rotate(${over ? c.rot * 1.6 : c.rot}deg)` }}>
          <div className="relative size-full overflow-hidden rounded-[1rem]"
            style={{ background: `linear-gradient(160deg, ${c.tint}, color-mix(in oklab, ${c.tint} 35%, #000))` }}>
            {i === 2
              ? <Anim name="clapper" className="absolute top-[24%] left-1/2 size-[62%] -translate-x-1/2" />
              : <Play className="absolute top-1/3 left-1/2 size-7 -translate-x-1/2 text-black/55" fill="currentColor" />}
            <div className="absolute inset-x-2 bottom-3 flex flex-col gap-1">
              <span className="h-1.5 w-4/5 rounded-full bg-black/35" />
              <span className="h-1.5 w-1/2 rounded-full bg-black/25" />
            </div>
          </div>
        </div>
      ))}
      {/* source timeline with three picked windows */}
      <div className="inset absolute inset-x-0 bottom-0 z-10 flex h-12 items-center gap-[3px] overflow-hidden px-3">
        {BARS.map((h, i) => <span key={i} className="w-full rounded-full bg-fg/25" style={{ height: `${h * 60}%` }} />)}
        {[[12, 10], [44, 9], [74, 12]].map(([l, w], i) => (
          <span key={i} className="absolute inset-y-1.5 rounded-lg border-2 border-accent bg-accent/20" style={{ left: `${l}%`, width: `${w}%` }} />
        ))}
      </div>
    </div>
  )
}

export default function DropZone({ onFile }: { onFile: (f: File, sidecar?: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const pick = (fl: FileList | null) => { // a video, plus an optional .srt/.vtt picked or dropped with it
    const all = [...(fl ?? [])], f = all.find(x => !isSidecar(x))
    if (f) onFile(f, all.find(isSidecar))
  }

  return (
    <div className="flex flex-col gap-5">
      <section
        aria-label="Upload a video"
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
        onDrop={e => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files) }}
        className={clsx('slab group/drop relative grid items-center gap-8 overflow-hidden p-6 sm:p-10 lg:grid-cols-[1.1fr_1fr]', over && 'outline-4 outline-offset-4 outline-accent')}
      >
        {over && <BorderBeam size={260} duration={4} width={3} />}
        <div className="flex flex-col gap-5">
          <p className="eyebrow">Long video → vertical shorts</p>
          <h1 className="font-display text-[2.6rem] leading-[0.95] font-bold tracking-tight text-fg uppercase sm:text-6xl">
            {over ? <>Let go<br />to start.</> : <>Long video in.<br /><span className="my-1 inline-block -rotate-2 rounded-2xl border-2 border-edge bg-accent px-3 pb-1 text-on-accent shadow-[0_5px_0_0_var(--edge)]">Shorts</span> out.</>}
          </h1>
          <p className="max-w-md text-base text-muted">
            Drop a stream recording or any long video. Reelio finds the strongest moments, ranks them and renders vertical clips, right here in your browser.
          </p>

          <div className={clsx('flex flex-col gap-3 rounded-[1.6rem] border-2 border-dashed p-2.5 transition sm:flex-row sm:items-center sm:rounded-full sm:pl-5',
            over ? 'border-accent bg-accent/10' : 'border-line bg-raised')}>
            <span className="flex min-w-0 flex-1 items-center gap-2.5 px-2 text-sm text-muted sm:px-0">
              <FileVideo className="size-5 shrink-0 text-accent" aria-hidden />
              <span>Drag a video here, or</span>
            </span>
            <input ref={input} type="file" multiple accept="video/*,audio/*,.srt,.vtt,.ass,.ssa" className="sr-only" aria-label="Choose a video file" tabIndex={-1}
              onChange={e => { pick(e.target.files); e.target.value = '' }} />
            <Button variant="primary" size="lg" icon={<Upload className="size-5" />} onClick={() => input.current?.click()}>Choose a video</Button>
          </div>
          <a href="https://github.com/Gous0786/reelio" target="_blank" rel="noopener noreferrer"
            className="inline-flex h-9 items-center gap-1.5 self-start rounded-full border border-line bg-raised px-4 text-[13px] font-semibold text-fg transition hover:border-fg/40 hover:bg-fg/8 sm:hidden">
            <Star className="size-4 text-hot" fill="currentColor" aria-hidden />Star on GitHub
          </a>
          <p className="text-xs text-muted">MP4, MOV, MKV or WebM · hours-long files are fine · embedded subtitles or a dropped .srt/.vtt are used instead of transcribing</p>
        </div>

        <ClipStack over={over} />
      </section>

      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map(({ Icon, title, text }, i) => (
          <li key={title} className="slab flex gap-4 p-4 sm:p-5">
            <span className="font-display text-4xl leading-none font-bold text-accent tabular-nums [-webkit-text-stroke:1px_var(--edge)]">0{i + 1}</span>
            <div>
              <p className="font-display flex items-center gap-1.5 text-sm font-bold text-fg"><Icon className="size-4 text-hot" aria-hidden />{title}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
