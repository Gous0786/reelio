import { useEffect, useRef } from 'react'

// Drifting soft colour orbs + a few twinkling stars on a canvas rendered at a quarter of the pixel count.
// `paused` freezes it on the current frame (used while Whisper / export own the GPU); prefers-reduced-motion
// and a hidden tab also freeze it. No animation frames are scheduled while frozen.
const ORBS = [
  { c: '139,92,246', r: 0.55, fx: 0.00011, fy: 0.00009, px: 0.0, py: 1.3, ax: 0.28, ay: 0.18, cx: 0.25, cy: 0.18 },
  { c: '217,70,239', r: 0.42, fx: 0.00008, fy: 0.00013, px: 2.1, py: 0.4, ax: 0.22, ay: 0.2, cx: 0.8, cy: 0.1 },
  { c: '56,189,248', r: 0.4, fx: 0.00012, fy: 0.00007, px: 4.0, py: 2.7, ax: 0.2, ay: 0.16, cx: 0.55, cy: 0.62 },
]
const STARS = Array.from({ length: 46 }, (_, i) => ({ x: (Math.sin(i * 12.9898) * 43758.5453) % 1, y: (Math.sin(i * 78.233) * 12345.6789) % 1, p: i * 1.7 }))

export default function Background({ paused }: { paused: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const state = useRef<{ t: number; last: number; raf: number; kick?: () => void }>({ t: 0, last: 0, raf: 0 })
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const s = state.current
    const SCALE = 0.5

    const draw = () => {
      const w = cv.width, h = cv.height, t = s.t
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'
      for (const o of ORBS) {
        const x = (o.cx + Math.sin(t * o.fx + o.px) * o.ax) * w
        const y = (o.cy + Math.cos(t * o.fy + o.py) * o.ay) * h
        const r = o.r * Math.max(w, h * 1.1)
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        g.addColorStop(0, `rgba(${o.c},0.30)`)
        g.addColorStop(0.5, `rgba(${o.c},0.09)`)
        g.addColorStop(1, `rgba(${o.c},0)`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }
      ctx.globalCompositeOperation = 'source-over'
      for (const st of STARS) {
        const a = 0.25 + 0.25 * Math.sin(t * 0.0012 + st.p)
        ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`
        ctx.fillRect(Math.abs(st.x) * w, Math.abs(st.y) * h * 0.8, 1.2, 1.2)
      }
    }
    const resize = () => {
      cv.width = Math.max(2, Math.round(window.innerWidth * SCALE))
      cv.height = Math.max(2, Math.round(window.innerHeight * SCALE))
      draw()
    }
    const frozen = () => pausedRef.current || mq.matches || document.hidden
    const loop = (now: number) => {
      s.raf = 0
      if (frozen()) return
      if (now - s.last >= 33) { s.t += now - s.last > 200 ? 33 : now - s.last; s.last = now; draw() } // ~30 fps, no time jump after a pause
      s.raf = requestAnimationFrame(loop)
    }
    const kick = () => { if (!s.raf && !frozen()) { s.last = performance.now(); s.raf = requestAnimationFrame(loop) } }
    resize()
    kick()
    window.addEventListener('resize', resize)
    document.addEventListener('visibilitychange', kick)
    mq.addEventListener('change', kick)
    s.kick = kick
    return () => {
      cancelAnimationFrame(s.raf); s.raf = 0
      window.removeEventListener('resize', resize)
      document.removeEventListener('visibilitychange', kick)
      mq.removeEventListener('change', kick)
    }
  }, [])

  useEffect(() => { state.current.kick?.() }, [paused])

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <canvas ref={ref} data-paused={paused} className="absolute inset-0 size-full opacity-90" />
      <div className="dot-grid absolute inset-0" />
    </div>
  )
}
