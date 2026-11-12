import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import notices from '../../THIRD_PARTY_NOTICES.md?raw'
import { IconButton } from './ui'

/** Third-party credits and licences: shows THIRD_PARTY_NOTICES.md (the same file that sits at the repo root). */
export default function CreditsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="animate-overlay-in fixed inset-0 z-[60] bg-black/55 backdrop-blur-sm" />
        <Dialog.Content aria-describedby={undefined}
          className="animate-overlay-in slab fixed top-1/2 left-1/2 z-[70] flex max-h-[calc(100dvh-1.5rem)] w-[min(94vw,46rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden focus:outline-none">
          <header className="flex items-center justify-between border-b border-line px-5 py-4">
            <Dialog.Title className="font-display text-2xl font-bold text-fg uppercase">Credits</Dialog.Title>
            <Dialog.Close asChild><IconButton label="Close credits"><X className="size-5" /></IconButton></Dialog.Close>
          </header>
          <pre className="flex-1 overflow-y-auto p-5 font-sans text-xs leading-relaxed whitespace-pre-wrap text-muted">{notices}</pre>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
