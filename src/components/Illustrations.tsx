import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import clapper from '../assets/lottie/clapper.json?url'
import hourglass from '../assets/lottie/hourglass.json?url'
import sparkles from '../assets/lottie/sparkles.json?url'
import scissors from '../assets/lottie/scissors.json?url'
import box from '../assets/lottie/box.json?url'
import rocket from '../assets/lottie/rocket.json?url'
import party from '../assets/lottie/party.json?url'
import search from '../assets/lottie/search.json?url'
import dizzy from '../assets/lottie/dizzy.json?url'
import camera from '../assets/lottie/camera.json?url'

/* Animated illustrations: Noto Emoji Animation by Google (https://googlefonts.github.io/noto-emoji-animation/),
 * licensed CC BY 4.0 (credited under Credits and in THIRD_PARTY_NOTICES.md). Each Lottie file is fetched only when its slot scrolls
 * into view, and the light SVG-only lottie-web player (MIT) is a separate lazy chunk. Under
 * prefers-reduced-motion the first frame is shown and nothing plays. While loading, the plain emoji glyph
 * stands in, so there is no layout shift. */
const ANIMS = {
  clapper: [clapper, '🎬'], hourglass: [hourglass, '⏳'], sparkles: [sparkles, '✨'], scissors: [scissors, '✂️'],
  box: [box, '📦'], rocket: [rocket, '🚀'], party: [party, '🎉'], search: [search, '🔎'], dizzy: [dizzy, '😵'], camera: [camera, '📸'],
} as const
export type AnimName = keyof typeof ANIMS

let player: Promise<typeof import('lottie-web/build/player/lottie_light')['default']> | null = null
const loadPlayer = () => (player ??= import('lottie-web/build/player/lottie_light').then(m => m.default))
const data = new Map<string, Promise<unknown>>()
const loadData = (url: string) => { if (!data.has(url)) data.set(url, fetch(url).then(r => r.json())); return data.get(url)! }

export function Anim({ name, className, loop = true }: { name: AnimName; className?: string; loop?: boolean }) {
  const host = useRef<HTMLSpanElement>(null)
  const [ready, setReady] = useState(false)
  const [url, glyph] = ANIMS[name]

  useEffect(() => {
    const el = host.current!
    let anim: { destroy: () => void } | null = null
    let dead = false
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return
      io.disconnect()
      try {
        const [lottie, json] = await Promise.all([loadPlayer(), loadData(url)])
        if (dead) return
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const a = lottie.loadAnimation({ container: el, renderer: 'svg', loop, autoplay: !still, animationData: json })
        if (still) a.goToAndStop(0, true)
        anim = a
        setReady(true)
      } catch { /* keep the glyph */ }
    }, { rootMargin: '120px' })
    io.observe(el)
    return () => { dead = true; io.disconnect(); anim?.destroy() }
  }, [url, loop])

  return (
    <span aria-hidden className={clsx('relative inline-grid shrink-0 place-items-center [container-type:size]', className)}>
      {!ready && <span className="absolute inset-0 grid place-items-center text-[72cqmin] leading-none">{glyph}</span>}
      <span ref={host} className="block size-full" />
    </span>
  )
}
