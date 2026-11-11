import { ALL_FORMATS, BlobSource, CanvasSink, Input } from 'mediabunny'
import type { FaceDetector } from '@mediapipe/tasks-vision'
import wasmJs from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBin from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'

/** Rectangle in fractions of the video frame (0..1). */
export interface Rect { x: number; y: number; w: number; h: number }
/** One facecam setting per video: the overlay rectangle (null = none) and whether the stacked layout is on. */
export interface FacecamSetting { rect: Rect | null; enabled: boolean; confidence: number; detected: boolean }
export interface FacecamResult { rect: Rect; confidence: number }

// MediaPipe BlazeFace short-range (230 KB model, loaded lazily) on the WASM/CPU delegate, so it never competes
// with Whisper for the GPU. Its input is 128x128, so a small webcam overlay is invisible in a whole 16:9 frame:
// each frame is searched as four square corner crops (faces fill ~5-20% of a crop), plus once whole as a veto
// for talking-head videos.
const MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
const FRAMES = 16
const WORK_W = 1280 // sampled frame width
const CROP = 0.4 // corner crop side, as a fraction of the frame width
const MIN_HITS = 0.6 // fraction of frames that must contain the face in the same corner
const TIMEOUT_MS = 90_000

let detector: Promise<FaceDetector> | null = null
const loadDetector = () => detector ??= (async () => {
  const { FaceDetector } = await import('@mediapipe/tasks-vision')
  return FaceDetector.createFromOptions(
    { wasmLoaderPath: wasmJs, wasmBinaryPath: wasmBin },
    { baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' }, runningMode: 'IMAGE', minDetectionConfidence: 0.5 },
  )
})().catch(e => { detector = null; throw e })

interface Box { cx: number; cy: number; w: number; h: number } // frame pixels (WORK_W wide)
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }
const percentile = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)] }

/** Looks for a webcam overlay. Resolves null when there is none, undefined when it could not run (unsupported
 *  codec, no WASM, timeout, abort). Never throws, so callers can run it next to transcription without guarding it. */
export async function detectFacecam(file: File, signal?: AbortSignal): Promise<FacecamResult | null | undefined> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  signal?.addEventListener('abort', () => ctl.abort())
  try {
    const vt = await input.getPrimaryVideoTrack()
    if (!vt || !(await vt.canDecode())) return null
    const sw = vt.displayWidth, sh = vt.displayHeight
    if (sh > sw) return null // portrait source: no corner overlay layout to look for
    const W = Math.min(WORK_W, sw), H = Math.round((sh * W) / sw)
    const S = Math.round(CROP * W)
    const dur = await input.computeDuration()
    const det = await loadDetector()

    const corners = [[0, 0], [W - S, 0], [0, H - S], [W - S, H - S]] // crop origins: TL TR BL BR
    const hits: (Box | null)[][] = corners.map(() => [])
    const grays: (Uint8Array | null)[][] = corners.map(() => [])
    let headFrames = 0, frames = 0
    const crop = new OffscreenCanvas(S, S), cctx = crop.getContext('2d', { willReadFrequently: true })!
    const sink = new CanvasSink(vt, { width: W, height: H, fit: 'fill' })
    const ts = Array.from({ length: FRAMES }, (_, i) => (dur * (i + 0.5)) / FRAMES)
    for await (const fr of sink.canvasesAtTimestamps(ts)) {
      if (ctl.signal.aborted) return undefined
      if (!fr) continue
      frames++
      const whole = det.detect(fr.canvas as HTMLCanvasElement).detections
      if (whole.some(d => (d.boundingBox?.width ?? 0) > 0.3 * W && (d.categories[0]?.score ?? 0) > 0.6)) headFrames++
      corners.forEach(([ox, oy], c) => {
        cctx.drawImage(fr.canvas as CanvasImageSource, ox, oy, S, S, 0, 0, S, S)
        let best: Box | null = null, bestScore = 0
        for (const d of det.detect(crop).detections) {
          const b = d.boundingBox, sc = d.categories[0]?.score ?? 0
          if (!b || sc < bestScore) continue
          const box = { cx: ox + b.originX + b.width / 2, cy: oy + b.originY + b.height / 2, w: b.width, h: b.height }
          const inCorner = (box.cx < W / 2) === (ox === 0) && (box.cy < H / 2) === (oy === 0)
          if (inCorner && box.w > 0.03 * W && box.w < 0.3 * W) { best = box; bestScore = sc }
        }
        hits[c].push(best)
        const px = cctx.getImageData(0, 0, S, S).data
        const g = new Uint8Array(S * S)
        for (let i = 0; i < g.length; i++) g[i] = (px[i * 4] * 77 + px[i * 4 + 1] * 150 + px[i * 4 + 2] * 29) >> 8
        grays[c].push(g)
      })
    }
    console.info(`[reelio] facecam scan: ${frames} frames, ${headFrames} with a large face, corner hits ${hits.map(h => h.filter(Boolean).length)}`)
    if (frames < 8 || headFrames > 0.4 * frames) return null

    // Pick the corner whose face is present in most frames at a stable position and scale.
    let pick: { c: number; conf: number; med: Box } | null = null
    corners.forEach((_, c) => {
      const b = hits[c].filter((x): x is Box => !!x)
      if (b.length < MIN_HITS * frames) return
      const med: Box = { cx: median(b.map(x => x.cx)), cy: median(b.map(x => x.cy)), w: median(b.map(x => x.w)), h: median(b.map(x => x.h)) }
      const stable = b.filter(x => Math.hypot(x.cx - med.cx, x.cy - med.cy) <= 0.5 * med.w && Math.abs(x.w - med.w) <= 0.3 * med.w).length
      const conf = (b.length / frames) * (stable / b.length)
      if (stable >= MIN_HITS * frames && (!pick || conf > pick.conf)) pick = { c, conf, med }
    })
    if (!pick) return null
    const { c, conf, med } = pick as { c: number; conf: number; med: Box }

    // Overlay rectangle: look outward from the face for a rectangular border that is static across frames (a strong
    // edge through most of the face's rows/columns in most frames); sides without one fall back to
    // the face box expanded to head and shoulders, or to the frame edge when that is close.
    const [ox, oy] = corners[c]
    const G = grays[c].filter((g): g is Uint8Array => !!g)
    const fl = med.cx - med.w / 2 - ox, fr = med.cx + med.w / 2 - ox, ft = med.cy - med.h / 2 - oy, fb = med.cy + med.h / 2 - oy
    const edge = (lo: number, hi: number, vertical: boolean, l2: number, h2: number, outer: 'low' | 'high') => {
      lo = Math.max(3, Math.round(lo)); hi = Math.min(S - 4, Math.round(hi))
      const sc: number[] = []
      for (let p = lo; p <= hi; p++) {
        const per = G.map(g => {
          let n = 0, t = 0
          for (let q = Math.max(2, Math.round(l2)); q < Math.min(S - 2, Math.round(h2)); q++, t++) {
            const i = vertical ? q * S + p : p * S + q, st = vertical ? 2 : 2 * S
            if (Math.abs(g[i + st] - g[i - st]) > 20) n++
          }
          return t ? n / t : 0
        })
        sc.push(percentile(per, 0.25))
      }
      if (!sc.length) return null
      const max = sc.reduce((m, v) => Math.max(m, v), 0)
      if (max < 0.5) return null
      const ok = sc.map((v, i) => (v >= 0.7 * max ? lo + i : -1)).filter(v => v >= 0)
      return outer === 'low' ? ok[0] : ok[ok.length - 1]
    }
    const sz = Math.max(med.w, med.h) * 2.8, ecy = med.cy + med.h * 0.1
    const near = 0.08 * W, gap = 0.2 * med.w, reach = 2.4 * med.w // cams are at most ~5 face widths wide
    // found edge (crop coords) -> frame coords; else the expansion `fallback` (frame coords), snapped to the frame edge when near
    const pick1 = (found: number | null | undefined, o: number, fallback: number, max: number) =>
      found != null ? found + o : fallback < near ? 0 : fallback > max - near ? max : fallback
    let x0 = pick1(edge(fl - reach, fl - gap, true, ft, fb, 'low'), ox, med.cx - sz / 2, W)
    let x1 = pick1(edge(fr + gap, fr + reach, true, ft, fb, 'high'), ox, med.cx + sz / 2, W)
    let y0 = pick1(edge(ft - reach, ft - gap, false, fl, fr, 'low'), oy, ecy - sz / 2, H)
    let y1 = pick1(edge(fb + gap, fb + reach, false, fl, fr, 'high'), oy, ecy + sz / 2, H)
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1)
    if (x1 - x0 < 0.05 * W || y1 - y0 < 0.05 * W) return null
    const rect = { x: x0 / W, y: y0 / H, w: (x1 - x0) / W, h: (y1 - y0) / H }
    console.info(`[reelio] facecam found in corner ${c}, confidence ${conf.toFixed(2)}`, rect)
    return { rect, confidence: Math.round(conf * 100) / 100 }
  } catch (e) {
    console.warn('facecam detection failed', e)
    return undefined
  } finally {
    clearTimeout(timer)
    input.dispose?.()
  }
}
