import type { VideoSample } from 'mediabunny'
import type { Rect } from './facecam'

export const OUT_W = 720, OUT_H = 1280
export const CAM_H = 426 // facecam band at the top (a third of the 1280 px height); gameplay gets the rest
const GAME_H = OUT_H - CAM_H

/** Cover-fit of a source region (frame fractions) into a box: returns the source rectangle in pixels to draw. */
function coverSrc(sw: number, sh: number, r: Rect, bw: number, bh: number) {
  let w = r.w * sw, h = r.h * sh
  const cx = (r.x + r.w / 2) * sw, cy = (r.y + r.h / 2) * sh
  if (w / h > bw / bh) w = (h * bw) / bh; else h = (w * bh) / bw
  return [cx - w / 2, cy - h / 2, w, h] as const
}
const WHOLE: Rect = { x: 0, y: 0, w: 1, h: 1 }

/** Per-frame compositor for the facecam layout: the overlay rectangle cropped to fill the top band, the frame
 *  centre-cropped to fill the area below. Same VideoSample.draw path the 'blur' mode uses. */
export function facecamComposer(cam: Rect) {
  const out = new OffscreenCanvas(OUT_W, OUT_H), ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  return (s: VideoSample) => {
    const sw = s.displayWidth, sh = s.displayHeight
    const [gx, gy, gw, gh] = coverSrc(sw, sh, WHOLE, OUT_W, GAME_H)
    s.draw(ctx, gx, gy, gw, gh, 0, CAM_H, OUT_W, GAME_H)
    const [cx, cy, cw, ch] = coverSrc(sw, sh, cam, OUT_W, CAM_H)
    s.draw(ctx, cx, cy, cw, ch, 0, 0, OUT_W, CAM_H)
    return out
  }
}

/** CSS for the preview: two copies of the same <video>, absolutely positioned inside the 9:16 phone box so that
 *  each shows its region cover-fitted into its band (clip-path trims the overflow). `aspect` = source width / height. */
export function previewStyles(cam: Rect, aspect: number) {
  const style = (r: Rect, top: number, bh: number): React.CSSProperties => {
    const [sx, sy, sw] = coverSrc(aspect, 1, r, OUT_W, bh) // source units: width = aspect, height = 1
    const k = OUT_W / sw // output px per source unit
    const vw = aspect * k, vh = k, vl = -sx * k, vt = top - sy * k // video box in output px
    const p = (v: number, of: number) => `${(v / of) * 100}%`
    return {
      position: 'absolute', objectFit: 'fill', maxWidth: 'none',
      width: p(vw, OUT_W), height: p(vh, OUT_H), left: p(vl, OUT_W), top: p(vt, OUT_H),
      clipPath: `inset(${p(top - vt, vh)} ${p(vl + vw - OUT_W, vw)} ${p(vt + vh - top - bh, vh)} ${p(-vl, vw)})`,
    }
  }
  return { cam: style(cam, 0, CAM_H), game: style(WHOLE, CAM_H, GAME_H) }
}
