import { useRef, useState } from 'react'
import { FileVideo, Lock, Scissors, Upload, Wand2 } from 'lucide-react'
import clsx from 'clsx'
import { HeroIllustration } from './Illustrations'
import { Button } from './ui'

const FEATURES = [
  { Icon: Lock, title: 'Stays on your device', text: 'Transcription runs locally with Whisper.' },
  { Icon: Wand2, title: 'Ranked by an LLM', text: 'The strongest moments, scored and captioned.' },
  { Icon: Scissors, title: 'Trim & export', text: 'Adjust the cut, then download a 9:16 MP4.' },
]

export default function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const pick = (fl: FileList | null) => { const f = fl?.[0]; if (f) onFile(f) }

  return (
    <div className="flex flex-col gap-6">
      <div
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files) }}
        className={clsx(
          'relative flex flex-col items-center gap-5 overflow-hidden rounded-3xl border-2 border-dashed px-6 py-10 text-center transition sm:py-14',
          over ? 'border-violet-400 bg-violet-500/10' : 'border-white/15 bg-panel/70 hover:border-violet-400/60',
        )}
      >
        <HeroIllustration className="w-full max-w-sm" />
        <div>
          <h2 className="font-display text-2xl font-semibold text-white sm:text-3xl">Drop a long video, get ranked shorts</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm text-zinc-300 sm:text-base">
            Upload a stream recording or long video. Reelio finds the best moments and renders vertical clips, all in your browser.
          </p>
        </div>
        <input ref={input} type="file" accept="video/*,audio/*" className="sr-only" aria-label="Choose a video file" onChange={e => { pick(e.target.files); e.target.value = '' }} />
        <Button variant="primary" size="lg" icon={<Upload className="size-5" />} onClick={() => input.current?.click()}>Choose a video</Button>
        <p className="flex items-center gap-1.5 text-xs text-zinc-400"><FileVideo className="size-3.5" aria-hidden />or drag and drop it here · MP4, MOV, MKV, WebM</p>
      </div>

      <ul className="grid gap-3 sm:grid-cols-3">
        {FEATURES.map(({ Icon, title, text }) => (
          <li key={title} className="flex gap-3 rounded-2xl border border-white/10 bg-white/3 p-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-200"><Icon className="size-4.5" aria-hidden /></span>
            <div>
              <p className="font-display text-sm font-semibold text-white">{title}</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-zinc-400">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
