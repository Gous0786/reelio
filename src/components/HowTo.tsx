import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Captions, ExternalLink, KeyRound, ShieldCheck, X } from 'lucide-react'
import { Anim } from './Illustrations'
import { Button, IconButton } from './ui'

// Key pages (checked): both open the provider's sign-in and continue to the key page.
const GEMINI_KEYS = 'https://aistudio.google.com/apikey'
const OPENROUTER_KEYS = 'https://openrouter.ai/keys'

function ExtLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-raised px-3.5 text-[13px] font-semibold text-fg transition hover:border-fg/40 hover:bg-fg/8">
      {children}<ExternalLink className="size-3.5" aria-hidden />
    </a>
  )
}

/** Step-by-step setup, short and scannable. Used inline on the upload screen and in the header dialog. */
export function HowToBody({ onSettings, onCredits }: { onSettings: () => void; onCredits: () => void }) {
  const steps: { title: string; text: string; action: ReactNode }[] = [
    { title: 'Get a free Gemini key', text: 'Sign in to Google AI Studio, choose “Create API key” and copy it.', action: <ExtLink href={GEMINI_KEYS}>Open AI Studio</ExtLink> },
    { title: 'Or a free OpenRouter key', text: 'Sign in to OpenRouter, choose “Create Key” and copy it. Free models need no payment, with a small daily limit.', action: <ExtLink href={OPENROUTER_KEYS}>Open OpenRouter</ExtLink> },
    { title: 'Paste it in Settings', text: 'Open Settings and paste the key under “LLM keys”. One key is enough.', action: <Button size="sm" icon={<KeyRound className="size-3.5" />} onClick={onSettings}>Open Settings</Button> },
    { title: 'Drop a video', text: 'Drop a long video on the page. It is transcribed on your device, then the best moments appear as clips.', action: null },
  ]
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <Anim name="rocket" className="size-14 sm:size-16" />
        <div>
          <p className="eyebrow">Get started</p>
          <h2 className="font-display text-2xl leading-tight font-bold text-fg uppercase sm:text-3xl">How to use Reelio</h2>
        </div>
      </div>

      <ol className="grid gap-3 sm:grid-cols-2">
        {steps.map((s, i) => (
          <li key={s.title} className="inset flex gap-4 p-4">
            <span aria-hidden className="font-display text-4xl leading-none font-bold text-accent tabular-nums [-webkit-text-stroke:1px_var(--edge)]">0{i + 1}</span>
            <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
              <p className="font-display text-sm font-bold text-fg">{s.title}</p>
              <p className="text-[13px] leading-relaxed text-muted">{s.text}</p>
              {s.action}
            </div>
          </li>
        ))}
      </ol>

      <ul className="flex flex-col gap-2 text-[13px] leading-relaxed text-muted">
        <li className="flex gap-2.5"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />Keys are stored only in this browser and are sent only to the provider they belong to.</li>
        <li className="flex gap-2.5"><KeyRound className="mt-0.5 size-4 shrink-0 text-hot" aria-hidden />Gemini is tried first, OpenRouter is the fallback. One key is enough.</li>
        <li className="flex gap-2.5"><Captions className="mt-0.5 size-4 shrink-0 text-zing" aria-hidden />A video with subtitles, or a .srt/.vtt file dropped with it, skips transcription.</li>
      </ul>

      <p className="text-xs text-muted">
        <button type="button" onClick={onCredits} className="underline underline-offset-2 hover:text-fg">Credits</button>
      </p>
    </div>
  )
}

export function HowToSection(p: { onSettings: () => void; onCredits: () => void }) {
  return <section className="slab p-5 sm:p-7" aria-label="How to use Reelio"><HowToBody {...p} /></section>
}

/** The same guide as a dialog, reachable from the header and Settings at any time. */
export function HowToDialog({ open, onOpenChange, onSettings, onCredits }: { open: boolean; onOpenChange: (o: boolean) => void; onSettings: () => void; onCredits: () => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-overlay-in fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
        <Dialog.Content aria-describedby={undefined}
          className="animate-overlay-in slab fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-1.5rem)] w-[min(94vw,46rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-5 focus:outline-none sm:p-7">
          <Dialog.Title className="sr-only">How to use Reelio</Dialog.Title>
          <Dialog.Close asChild><IconButton label="Close how-to" className="absolute top-3 right-3"><X className="size-5" /></IconButton></Dialog.Close>
          <HowToBody onSettings={onSettings} onCredits={onCredits} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
