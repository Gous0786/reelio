import type { CSSProperties } from 'react'

/** Border Beam from Vengeance UI (MIT, github.com/Ashutoshx7/VengenceUI, src/components/ui/border-beam.tsx; licence
 *  text in FluidMorphBg.tsx). Same technique: a gradient square riding offset-path around a masked border.
 *  The keyframes and styles live in index.css (`.border-beam`) and default to the theme's accent colours.
 *  Put it inside a `relative` element with a border radius. Hidden under prefers-reduced-motion. */
export default function BorderBeam({ size = 160, duration = 6, width = 2, delay = 0, from, to }: {
  size?: number; duration?: number; width?: number; delay?: number; from?: string; to?: string
}) {
  return (
    <span aria-hidden className="border-beam"
      style={{ '--size': size, '--duration': duration, '--bw': width, ...(from && { '--from': from }), ...(to && { '--to': to }), animationDelay: `${delay}s` } as CSSProperties} />
  )
}
