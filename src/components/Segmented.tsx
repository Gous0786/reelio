import * as ToggleGroup from '@radix-ui/react-toggle-group'
import clsx from 'clsx'
import type { ReactNode } from 'react'

/** Single-select segmented control (Radix ToggleGroup). Never lets the selection become empty. */
export default function Segmented<T extends string>({ value, onChange, options, label, className, disabled }: {
  value: T; onChange: (v: T) => void; label: string; className?: string; disabled?: boolean
  options: { value: T; label: ReactNode; hint?: string }[]
}) {
  return (
    <ToggleGroup.Root
      type="single" value={value} aria-label={label} disabled={disabled}
      onValueChange={v => { if (v) onChange(v as T) }}
      className={clsx('inline-flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-black/30 p-1', disabled && 'opacity-50', className)}
    >
      {options.map(o => (
        <ToggleGroup.Item
          key={o.value} value={o.value} title={o.hint}
          className="inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-medium text-zinc-300 transition hover:text-white data-[state=on]:bg-violet-500 data-[state=on]:text-white data-[state=on]:shadow"
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
