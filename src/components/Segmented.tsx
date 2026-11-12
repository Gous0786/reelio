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
      className={clsx('inline-flex flex-wrap gap-1 rounded-full border border-line bg-raised p-1', disabled && 'opacity-50', className)}
    >
      {options.map(o => (
        <ToggleGroup.Item
          key={o.value} value={o.value} title={o.hint}
          className="inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-muted transition hover:text-fg data-[state=on]:bg-accent data-[state=on]:text-on-accent"
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
