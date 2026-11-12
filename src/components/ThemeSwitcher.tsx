import * as ToggleGroup from '@radix-ui/react-toggle-group'
import * as m from 'motion/react-m'
import { THEMES, type ThemeId } from '../lib/theme'

/** Three swatch buttons (Radix ToggleGroup: arrow keys move, Enter/Space selects). */
export default function ThemeSwitcher({ value, onChange }: { value: ThemeId; onChange: (t: ThemeId) => void }) {
  return (
    <ToggleGroup.Root type="single" value={value} onValueChange={v => { if (v) onChange(v as ThemeId) }} aria-label="Colour theme"
      className="flex items-center gap-1 rounded-full border border-line bg-surface p-1">
      {THEMES.map(t => (
        <ToggleGroup.Item key={t.id} value={t.id} aria-label={`${t.name} theme`} title={`${t.name} theme`}
          className="relative grid size-8 place-items-center rounded-full">
          {value === t.id && (
            <m.span layoutId="theme-ring" className="absolute inset-0 rounded-full ring-2 ring-fg" transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
          )}
          <span aria-hidden className="relative size-5.5 overflow-hidden rounded-full ring-1 ring-black/20"
            style={{ background: `conic-gradient(${t.swatch[0]} 0 50%, ${t.swatch[1]} 50% 75%, ${t.swatch[2]} 75%)` }} />
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}
