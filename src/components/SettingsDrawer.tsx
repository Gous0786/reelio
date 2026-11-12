import { useState, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, Cpu, Crop, Eye, EyeOff, KeyRound, Maximize2, Palette, Settings, X } from 'lucide-react'
import * as ToggleGroup from '@radix-ui/react-toggle-group'
import { THEMES, type ThemeId } from '../lib/theme'
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
  theme: ThemeId; setTheme: (t: ThemeId) => void
}

function Field({ id, label, help, children }: { id?: string; label: string; help?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-semibold text-fg">{label}</label>
      {children}
      {help && <p className="text-xs leading-relaxed text-muted">{help}</p>}
    </div>
  )
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="inset flex flex-col gap-4 p-4">
      <h3 className="eyebrow flex items-center gap-2">{icon}{title}</h3>
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
        className="h-11 w-full rounded-full border-2 border-line bg-surface pr-12 pl-4 text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none"
      />
      <IconButton size="sm" label={show ? 'Hide key' : 'Show key'} onClick={() => setShow(s => !s)} className="absolute top-1.5 right-1.5">
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
        <Dialog.Overlay className="animate-overlay-in fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" />
        <Dialog.Content
          className="animate-drawer-in slab fixed inset-y-2 right-2 z-50 flex w-[calc(100%-1rem)] max-w-md flex-col overflow-hidden focus:outline-none"
          aria-describedby={undefined}
        >
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <Dialog.Title className="font-display text-2xl font-bold text-fg uppercase">Settings</Dialog.Title>
            <Dialog.Close asChild><IconButton label="Close settings"><X className="size-5" /></IconButton></Dialog.Close>
          </header>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
            <Section icon={<Palette className="size-4" />} title="Theme">
              <ToggleGroup.Root type="single" value={p.theme} onValueChange={v => { if (v) p.setTheme(v as ThemeId) }} aria-label="Colour theme" className="grid grid-cols-3 gap-2">
                {THEMES.map(t => (
                  <ToggleGroup.Item key={t.id} value={t.id} className="group relative flex flex-col overflow-hidden rounded-2xl border-2 border-line text-left transition data-[state=on]:border-fg">
                    <span aria-hidden className="relative block h-14" style={{ background: t.swatch[2] }}>
                      <span className="absolute bottom-2 left-2 h-5 w-9 rounded-full" style={{ background: t.swatch[0] }} />
                      <span className="absolute top-2 right-2 size-4 rounded-full" style={{ background: t.swatch[1] }} />
                    </span>
                    <span className="flex items-center justify-between px-2.5 py-1.5 text-xs font-bold text-fg">{t.name}<Check className="size-3.5 opacity-0 group-data-[state=on]:opacity-100" aria-hidden /></span>
                  </ToggleGroup.Item>
                ))}
              </ToggleGroup.Root>
            </Section>

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
          <footer className="border-t border-line px-5 py-3 text-xs text-muted">Changes save automatically.</footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
