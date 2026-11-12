import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'
import { AlertOctagon, Info, TriangleAlert } from 'lucide-react'
import { Anim } from './Illustrations'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'btn-pop font-bold', // Vengeance UI PopButton press, see index.css
  secondary: 'bg-raised text-fg border border-line hover:border-fg/40 hover:bg-fg/8',
  ghost: 'text-muted hover:bg-fg/8 hover:text-fg',
  danger: 'bg-bad/12 text-bad border border-bad/40 hover:bg-bad/20',
}
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-[13px] gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
  lg: 'h-13 px-7 text-base gap-2.5',
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
        'relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold transition disabled:opacity-50',
        variants[variant], sizes[size], className,
      )}
    >
      {icon}
      {children}
    </button>
  )
})

/** Round icon-only button. `label` is required: it is the accessible name and the tooltip. */
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

type Tone = 'neutral' | 'accent' | 'good' | 'warn' | 'hot'
export function Chip({ children, tone = 'neutral', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  const tones: Record<Tone, string> = {
    neutral: 'bg-fg/6 text-muted border-line',
    accent: 'bg-accent text-on-accent border-transparent',
    good: 'bg-good/12 text-good border-good/35',
    warn: 'bg-warn/12 text-warn border-warn/35',
    hot: 'bg-hot/12 text-hot border-hot/40',
  }
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold', tones[tone], className)}>
      {children}
    </span>
  )
}

/** Message panel. Errors get an animated illustration and a stronger frame. */
export function Alert({ tone = 'error', title, children, actions }: { tone?: 'error' | 'warn' | 'info'; title?: string; children: ReactNode; actions?: ReactNode }) {
  const tones = {
    error: 'border-bad/50 bg-bad/10',
    warn: 'border-warn/45 bg-warn/10',
    info: 'border-zing/45 bg-zing/10',
  }
  const Icon = tone === 'error' ? AlertOctagon : tone === 'warn' ? TriangleAlert : Info
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={clsx('flex gap-3.5 rounded-3xl border-2 bg-surface p-4 text-sm sm:p-5', tones[tone])}>
      {tone === 'error' && title
        ? <Anim name="dizzy" className="size-12 sm:size-14" />
        : <Icon className={clsx('mt-0.5 size-5 shrink-0', tone === 'error' ? 'text-bad' : tone === 'warn' ? 'text-warn' : 'text-zing')} aria-hidden />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-display mb-1 text-lg leading-tight font-bold text-fg">{title}</p>}
        <div className="leading-relaxed whitespace-pre-line text-fg/90">{children}</div>
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  )
}

export function Progress({ value, className, label }: { value: number | null; className?: string; label?: string }) {
  return (
    <div
      role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value ?? undefined} aria-label={label}
      className={clsx('relative h-2.5 overflow-hidden rounded-full bg-fg/10', className)}
    >
      {value === null
        ? <div className="animate-indeterminate absolute inset-y-0 w-2/5 rounded-full bg-accent" />
        : <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.max(2, Math.min(100, value))}%` }} />}
    </div>
  )
}

export const card = 'slab'
