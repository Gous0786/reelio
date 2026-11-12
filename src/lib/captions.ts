import type { Word } from './types'
import { CAM_H, OUT_H, OUT_W } from './facecamLayout'
import fontUrl from '@fontsource/montserrat/files/montserrat-latin-800-normal.woff2?url'

// Burned-in captions. One draw function (drawCaptions) paints onto any 2D context in the 720x1280 output space;
// the preview overlays it on a canvas and the export draws it onto each composed frame, so both match.

export type CaptionStyle = 'highlight' | 'clean' | 'pop'
export type CaptionLayout = 'cover' | 'blur' | 'facecam'
export interface CaptionConfig { words: Word[]; style: CaptionStyle }

export const CAPTION_STYLES: { value: CaptionStyle; label: string; hint: string }[] = [
  { value: 'highlight', label: 'Highlight', hint: 'Bold words, the spoken one lights up' },
  { value: 'clean', label: 'Clean', hint: 'White subtitles on a dark box' },
  { value: 'pop', label: 'Pop', hint: 'One big word at a time' },
]

const FAMILY = 'ReelioCaption'
let fontReady: Promise<void> | null = null
/** Loads the bundled caption font (once). Await it before drawing for export so the first frames use it. */
export function loadCaptionFont(): Promise<void> {
  fontReady ??= new FontFace(FAMILY, `url(${fontUrl})`, { weight: '800' }).load()
    .then(f => { document.fonts.add(f) })
    .catch(() => { fontReady = null }) // draws with the fallback font; a later call may retry
  return fontReady
}

interface Chunk { words: Word[]; show: number; hide: number } // show/hide: source-time window the chunk is on screen
export type CaptionTrack = { style: CaptionStyle; chunks: Chunk[] }

const END_PUNCT = /[.!?…]["')\]]?$/
const GAP_BREAK = 0.6 // seconds of silence that always starts a new chunk
const HOLD = 0.35 // a chunk stays up until the next one if they are closer than this

// Per style: max characters / words per chunk (one chunk = one caption "line" on screen).
const LIMITS: Record<CaptionStyle, { chars: number; words: number }> = {
  highlight: { chars: 18, words: 4 },
  clean: { chars: 34, words: 7 },
  pop: { chars: 99, words: 1 },
}

/** Splits the words that fall inside [start, end] into timed caption chunks. */
export function buildTrack(words: Word[], style: CaptionStyle, start: number, end: number): CaptionTrack {
  const ws = words.filter(w => w.end > start && w.start < end && w.text.trim())
  const lim = LIMITS[style]
  const groups: Word[][] = []
  let cur: Word[] = [], chars = 0
  for (const w of ws) {
    const prev = cur[cur.length - 1]
    if (cur.length && (cur.length >= lim.words || chars + w.text.length + 1 > lim.chars || w.start - prev.end > GAP_BREAK || END_PUNCT.test(prev.text))) {
      groups.push(cur); cur = []; chars = 0
    }
    cur.push(w); chars += w.text.length + 1
  }
  if (cur.length) groups.push(cur)
  const chunks = groups.map((g, i) => {
    const first = g[0].start, last = g[g.length - 1].end
    const next = groups[i + 1]?.[0].start
    const hide = next !== undefined && next - last < HOLD ? next : last + 0.2
    return { words: g, show: Math.max(start, first), hide: Math.min(end, hide) }
  })
  return { style, chunks }
}

const ACCENT = '#ffd23f'
const SAFE_TOP = 0.12, SAFE_BOTTOM = 0.78 // blur/cover safe area (platform UI covers the very top and bottom)

interface Spec { size: number; upper: boolean; lines: number; lineGap: number }
const SPEC: Record<CaptionStyle, Spec> = {
  highlight: { size: 64, upper: true, lines: 2, lineGap: 1.12 },
  clean: { size: 44, upper: false, lines: 3, lineGap: 1.2 },
  pop: { size: 112, upper: true, lines: 1, lineGap: 1.1 },
}

let measureCtx: OffscreenCanvasRenderingContext2D | null = null
const measure = (font: string, text: string) => {
  measureCtx ??= new OffscreenCanvas(8, 8).getContext('2d')!
  measureCtx.font = font
  return measureCtx.measureText(text).width
}

/** Greedy wrap of word texts into at most `maxLines` lines no wider than `maxW`, shrinking the font until it fits. */
function fit(texts: string[], spec: Spec, maxW: number) {
  for (let size = spec.size; ; size *= 0.92) {
    const font = `800 ${size}px ${FAMILY}, 'Arial Black', Arial, sans-serif`
    const space = measure(font, ' ')
    const lines: { idx: number[]; w: number }[] = []
    let ok = true
    for (let i = 0; i < texts.length; i++) {
      const w = measure(font, texts[i])
      if (w > maxW) ok = false
      const l = lines[lines.length - 1]
      if (l && l.w + space + w <= maxW) { l.idx.push(i); l.w += space + w } else lines.push({ idx: [i], w })
    }
    if ((ok && lines.length <= spec.lines) || size < spec.size * 0.4) return { font, size, lines, space }
  }
}

const easeOutBack = (x: number) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2) }

/** Paints the caption for source time `t` (seconds in the original video) onto `ctx`, a 720x1280 canvas (the output
 *  size; the preview canvas uses the same coordinates). The text block never leaves the frame: it is fitted to 84%
 *  of the width and, outside the facecam layout, clamped to the safe area. Facecam: centred on the seam between the
 *  two panes. */
export function drawCaptions(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, track: CaptionTrack, t: number, layout: CaptionLayout) {
  const chunk = track.chunks.find(c => t >= c.show && t < c.hide)
  if (!chunk) return
  const spec = SPEC[track.style]
  const upper = (s: string) => (spec.upper ? s.toUpperCase() : s)
  const texts = chunk.words.map(w => upper(w.text.trim()))
  const f = fit(texts, spec, OUT_W * 0.84 - (track.style === 'clean' ? 56 : 0))
  const lh = f.size * spec.lineGap
  const blockH = f.lines.length * lh
  // which word is "current": the last one that has started
  let cur = 0
  chunk.words.forEach((w, i) => { if (t >= w.start) cur = i })

  let cy = layout === 'facecam' ? CAM_H : OUT_H * 0.7
  if (layout !== 'facecam') cy = Math.min(OUT_H * SAFE_BOTTOM - blockH / 2, Math.max(OUT_H * SAFE_TOP + blockH / 2, cy))
  const top = cy - blockH / 2

  ctx.save()
  ctx.font = f.font
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  if (track.style === 'pop') {
    const x = Math.min(1, (t - chunk.words[0].start) / 0.14)
    const s = 0.72 + 0.28 * easeOutBack(Math.max(0, x))
    ctx.translate(OUT_W / 2, cy); ctx.scale(s, s); ctx.translate(-OUT_W / 2, -cy)
  }
  f.lines.forEach((l, li) => {
    const y = top + lh * (li + 0.5)
    let x = (OUT_W - l.w) / 2
    if (track.style === 'clean') {
      const padX = 22, padY = f.size * 0.16
      ctx.fillStyle = 'rgba(0,0,0,0.62)'
      ctx.beginPath()
      ctx.roundRect(x - padX, y - lh / 2 + padY * 0.4, l.w + padX * 2, lh - padY * 0.4, 16)
      ctx.fill()
    }
    for (const i of l.idx) {
      const w = measure(f.font, texts[i])
      if (track.style !== 'clean') {
        ctx.lineWidth = f.size * 0.2
        ctx.strokeStyle = '#000'
        ctx.strokeText(texts[i], x, y)
      }
      ctx.fillStyle = track.style === 'pop' || (track.style === 'highlight' && i === cur) ? ACCENT : '#fff'
      ctx.fillText(texts[i], x, y)
      x += w + f.space
    }
  })
  ctx.restore()
}
