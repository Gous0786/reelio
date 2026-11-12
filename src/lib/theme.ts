import { useEffect, useState } from 'react'

export const THEMES = [
  { id: 'citrus', name: 'Citrus', swatch: ['#c6f432', '#ff6a3d', '#08110e'] },
  { id: 'ember', name: 'Ember', swatch: ['#ff7f1f', '#ff4d8d', '#140906'] },
  { id: 'pop', name: 'Pop', swatch: ['#2346ff', '#c42c12', '#fff3d6'] },
] as const
export type ThemeId = (typeof THEMES)[number]['id']
const KEY = 'reelio_theme'
const valid = (v: string | null): v is ThemeId => THEMES.some(t => t.id === v)

/** Current theme, applied as <html data-theme> and remembered in localStorage (index.html applies it pre-paint). */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>(() => { const v = localStorage.getItem(KEY); return valid(v) ? v : 'citrus' })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(KEY, theme)
  }, [theme])
  return [theme, setTheme] as const
}
