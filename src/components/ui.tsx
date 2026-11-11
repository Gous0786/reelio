import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary:
    'bg-linear-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-900/30 hover:brightness-110 active:brightness-95',
  secondary: 'bg-white/8 text-zinc-100 border border-white/10 hover:bg-white/14',
  ghost: 'text-zinc-300 hover:bg-white/8 hover:text-white',
  danger: 'bg-rose-500/15 text-rose-200 border border-rose-400/30 hover:bg-rose-500/25',
}
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
}

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; size?: Size; icon?: ReactNode }

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button(
  { variant = 'secondary', size = 'md', icon, className, children, ...rest }, ref,
) {
  return (
    <button
      ref={ref}
      {...rest}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full font-semibold transition disabled:opacity-50 disabled:hover:brightness-100',
        variants[variant], sizes[size], className,
      )}
    >
      {icon}
      {children}
    </button>
  )
})

/** Square icon-only button. `label` is required: it is the accessible name and the tooltip. */
export const IconButton = forwardRef<HTMLButtonElement, Omit<BtnProps, 'children' | 'icon'> & { label: string; children: ReactNode }>(
  function IconButton({ label, variant = 'ghost', size = 'md', className, children, ...rest }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        title={label}
        {...rest}
        className={clsx(
          'inline-flex shrink-0 items-center justify-center rounded-full transition disabled:opacity-40',
          variants[variant], size === 'sm' ? 'size-8' : 'size-10', className,
        )}
      >
        {children}
      </button>
    )
  },
)

export function Chip({ children, tone = 'neutral', className }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'warn'; className?: string }) {
  const tones = {
    neutral: 'bg-white/6 text-zinc-300 border-white/10',
    accent: 'bg-violet-500/15 text-violet-200 border-violet-400/25',
    good: 'bg-emerald-500/12 text-emerald-200 border-emerald-400/25',
    warn: 'bg-amber-500/12 text-amber-200 border-amber-400/25',
  }
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}

export function Alert({ tone = 'error', title, children, actions }: { tone?: 'error' | 'warn' | 'info'; title?: string; children: ReactNode; actions?: ReactNode }) {
  const tones = {
    error: 'border-rose-400/30 bg-rose-500/10 text-rose-100',
    warn: 'border-amber-400/30 bg-amber-500/10 text-amber-100',
    info: 'border-sky-400/30 bg-sky-500/10 text-sky-100',
  }
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={clsx('rounded-2xl border p-4 text-sm', tones[tone])}>
      {title && <p className="font-display mb-1 text-base font-semibold">{title}</p>}
      <div className="whitespace-pre-line leading-relaxed">{children}</div>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function Progress({ value, className }: { value: number | null; className?: string }) {
  return (
    <div
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined}
      className={clsx('relative h-2 overflow-hidden rounded-full bg-white/10', className)}
    >
      {value === null
        ? <div className="animate-indeterminate absolute inset-y-0 w-2/5 rounded-full bg-violet-400" />
        : <div className="h-full rounded-full bg-linear-to-r from-violet-500 to-fuchsia-400 transition-[width] duration-300" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />}
    </div>
  )
}

export const card = 'rounded-3xl border border-white/10 bg-panel/80 shadow-xl shadow-black/30'
