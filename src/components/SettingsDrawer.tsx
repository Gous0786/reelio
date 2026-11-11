import { useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Cpu, Crop, Eye, EyeOff, KeyRound, Maximize2, Settings, X } from 'lucide-react'
import type { Fit } from '../lib/media'
import type { WhisperModel } from '../lib/transcribe'
import Segmented from './Segmented'
import { Button, IconButton } from './ui'

export interface SettingsValues {
  geminiKey: string; apiKey: string
  modelPref: 'auto' | WhisperModel
  workerPref: 'auto' | '1' | '2' | '3'
  fit: Fit
}
export interface SettingsProps extends SettingsValues {
  setGeminiKey: (v: string) => void; setApiKey: (v: string) => void
  setModelPref: (v: 'auto' | WhisperModel) => void
  setWorkerPref: (v: 'auto' | '1' | '2' | '3') => void
  setFit: (v: Fit) => void
}

function Field({ id, label, help, children }: { id?: string; label: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-zinc-100">{label}</label>
      {children}
      {help && <p className="text-xs leading-relaxed text-zinc-400">{help}</p>}
    </div>
  )
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/3 p-4">
      <h3 className="font-display flex items-center gap-2 text-sm font-semibold tracking-wide text-zinc-300 uppercase">{icon}{title}</h3>
      {children}
    </section>
  )
}

function SecretInput({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        id={id} type={show ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} autoComplete="off" spellCheck={false}
        className="h-10 w-full rounded-xl border border-white/10 bg-black/30 pr-11 pl-3 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50"
      />
      <IconButton size="sm" label={show ? 'Hide key' : 'Show key'} onClick={() => setShow(s => !s)} className="absolute top-1 right-1">
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </IconButton>
    </div>
  )
}

export default function SettingsDrawer(p: SettingsProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button variant="secondary" size="sm" icon={<Settings className="size-4" />} aria-label="Open settings">
          <span className="hidden sm:inline">Settings</span>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-overlay-in fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content
          className="animate-drawer-in fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-white/10 bg-[#0b0b12] shadow-2xl focus:outline-none"
          aria-describedby={undefined}
        >
          <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <Dialog.Title className="font-display text-lg font-semibold text-white">Settings</Dialog.Title>
            <Dialog.Close asChild><IconButton label="Close settings"><X className="size-5" /></IconButton></Dialog.Close>
          </header>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
            <Section icon={<KeyRound className="size-4" />} title="LLM keys">
              <Field id="gemini" label="Gemini API key" help="Optional. Tried first when set. Stays in this browser's local storage.">
                <SecretInput id="gemini" value={p.geminiKey} onChange={p.setGeminiKey} placeholder="AIza… / AQ.…" />
              </Field>
              <Field id="openrouter" label="OpenRouter API key" help="Optional. Empty uses the built-in /api/chat proxy.">
                <SecretInput id="openrouter" value={p.apiKey} onChange={p.setApiKey} placeholder="sk-or-…" />
              </Field>
            </Section>

            <Section icon={<Cpu className="size-4" />} title="Transcription">
              <Field label="Speech model" help="Tiny is faster; base is more accurate but slower. Applies to the next video.">
                <Segmented label="Speech model" value={p.modelPref} onChange={p.setModelPref} options={[
                  { value: 'auto', label: 'Auto', hint: 'auto (whisper-tiny)' },
                  { value: 'onnx-community/whisper-tiny', label: 'Tiny', hint: 'whisper-tiny (faster)' },
                  { value: 'onnx-community/whisper-base', label: 'Base', hint: 'whisper-base (better, slower)' },
                ]} />
              </Field>
              <Field label="Parallel workers" help="Auto uses up to 3 on a capable GPU, 1 on CPU or low-memory devices.">
                <Segmented label="Parallel workers" value={p.workerPref} onChange={p.setWorkerPref} options={[
                  { value: 'auto', label: 'Auto' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' },
                ]} />
              </Field>
            </Section>

            <Section icon={<Crop className="size-4" />} title="Export framing">
              <Field label="Fit mode" help="Centre crop fills the 9:16 frame. Fit + blur keeps the whole picture over a blurred copy of itself.">
                <Segmented label="Fit mode" value={p.fit} onChange={p.setFit} options={[
                  { value: 'cover', label: <><Crop className="size-3.5" />Centre crop</> },
                  { value: 'blur', label: <><Maximize2 className="size-3.5" />Fit + blur</> },
                ]} />
              </Field>
            </Section>
          </div>
          <footer className="border-t border-white/10 px-5 py-3 text-xs text-zinc-400">Changes save automatically.</footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
