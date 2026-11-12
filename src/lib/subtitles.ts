import type { Segment, Word } from './types'

// Soft subtitles as a transcript source. mediabunny only *writes* subtitle tracks, so this is a small lazy demuxer:
//  - Matroska/WebM: walks the EBML element headers (jumping over payloads) and keeps only the blocks that belong to
//    text subtitle tracks (SRT, ASS/SSA, WebVTT). A scan streams over the file in small windows; nothing but the
//    cue text is kept in memory.
//  - MP4/MOV: reads moov, builds the sample table of text tracks (tx3g / mov_text, wvtt) and reads just those samples.
//  - Sidecar .srt / .vtt / .ass / .ssa files.
// Bitmap subtitles (PGS, VobSub, DVB) are listed as unusable. The result has the same shape Whisper produces
// (Segment[] + Word[]), so nothing downstream changes.

export interface Cue { start: number; end: number; text: string }
export interface SubTrack { id: string; lang: string; name: string; codec: string; forced: boolean; text: boolean }
export interface SubScan { tracks: SubTrack[]; cues: Record<string, Cue[]> } // cues: raw (uncleaned) per text track id

const dec = new TextDecoder('utf-8')
type Blobish = Pick<Blob, 'slice' | 'size'>

/** Windowed reader over a Blob: sequential scans cost one slice() per window, header walks only read what they touch. */
class Reader {
  private base = -1
  private buf = new Uint8Array(0)
  private f: Blobish
  private win: number
  constructor(f: Blobish, win = 1 << 22) { this.f = f; this.win = win }
  get size() { return this.f.size }
  async bytes(pos: number, len: number): Promise<Uint8Array> {
    len = Math.max(0, Math.min(len, this.f.size - pos))
    if (pos >= this.base && pos + len <= this.base + this.buf.length) return this.buf.subarray(pos - this.base, pos - this.base + len)
    const n = Math.min(Math.max(len, this.win), this.f.size - pos)
    this.buf = new Uint8Array(await this.f.slice(pos, pos + n).arrayBuffer()); this.base = pos
    return this.buf.subarray(0, len)
  }
  /** An owned copy of a range. Small ranges come from the window: a separate File.slice() per tiny read costs a
   *  browser round trip each (15k of them made a scan take minutes instead of seconds). */
  async copy(pos: number, len: number): Promise<Uint8Array> {
    if (len <= this.win) return (await this.bytes(pos, len)).slice()
    return new Uint8Array(await this.f.slice(pos, pos + len).arrayBuffer())
  }
}

// ---------------------------------------------------------------- Matroska
const ID = {
  Segment: 0x18538067, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Tracks: 0x1654ae6b, TrackEntry: 0xae,
  TrackNumber: 0xd7, TrackType: 0x83, CodecID: 0x86, Language: 0x22b59c, LanguageBCP47: 0x22b59d, Name: 0x536e,
  FlagForced: 0x55aa, ContentEncodings: 0x6d80, ContentEncoding: 0x6240, ContentCompression: 0x5034, ContentCompAlgo: 0x4254,
  Cluster: 0x1f43b675, Timecode: 0xe7, SimpleBlock: 0xa3, BlockGroup: 0xa0, Block: 0xa1, BlockDuration: 0x9b,
} as const
const TOP = new Set<number>([ID.Cluster, 0x1c53bb6b /* Cues */, 0x1254c367 /* Tags */, 0x1043a770 /* Chapters */, 0x1941a469 /* Attachments */, ID.Tracks, ID.Info, 0x114d9b74 /* SeekHead */])

interface El { id: number; size: number; hdr: number; unknown: boolean }
async function elHeader(r: Reader, pos: number): Promise<El | null> {
  const b = await r.bytes(pos, 12)
  if (b.length < 2) return null
  let n = 1
  while (n <= 4 && !(b[0] & (0x80 >> (n - 1)))) n++
  if (n > 4) return null
  let id = 0
  for (let i = 0; i < n; i++) id = id * 256 + b[i]
  const s0 = b[n]
  if (s0 === undefined) return null
  let m = 1
  while (m <= 8 && !(s0 & (0x80 >> (m - 1)))) m++
  if (m > 8 || n + m > b.length) return null
  let size = s0 & (0xff >> m), allOnes = size === (0xff >> m)
  for (let i = 1; i < m; i++) { size = size * 256 + b[n + i]; if (b[n + i] !== 0xff) allOnes = false }
  return { id, size, hdr: n + m, unknown: allOnes }
}
const uint = (b: Uint8Array) => b.reduce((a, x) => a * 256 + x, 0)

interface MkvTrack extends SubTrack { num: number; zlib: boolean; header: string }
const MKV_TEXT = /^S_TEXT\/(UTF8|ASCII|SSA|ASS|WEBVTT)$/

async function inflate(b: Uint8Array): Promise<Uint8Array> {
  const s = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(s).arrayBuffer())
}

async function mkvTracks(r: Reader, from: number, to: number): Promise<MkvTrack[]> {
  const out: MkvTrack[] = []
  for (let p = from; p < to;) {
    const e = await elHeader(r, p); if (!e) break
    if (e.id === ID.TrackEntry) {
      const t: MkvTrack = { id: '', num: 0, lang: '', name: '', codec: '', forced: false, text: false, zlib: false, header: '' }
      let type = 0, bcp = ''
      const end = p + e.hdr + e.size
      for (let q = p + e.hdr; q < end;) {
        const c = await elHeader(r, q); if (!c) break
        const body = await r.copy(q + c.hdr, Math.min(c.size, 1 << 16))
        if (c.id === ID.TrackNumber) t.num = uint(body)
        else if (c.id === ID.TrackType) type = uint(body)
        else if (c.id === ID.CodecID) t.codec = dec.decode(body)
        else if (c.id === ID.Language) t.lang = dec.decode(body).replace(/\0/g, '')
        else if (c.id === ID.LanguageBCP47) bcp = dec.decode(body).replace(/\0/g, '')
        else if (c.id === ID.Name) t.name = dec.decode(body)
        else if (c.id === ID.FlagForced) t.forced = uint(body) === 1
        else if (c.id === 0x63a2) t.header = dec.decode(body) // CodecPrivate (the ASS script header)
        else if (c.id === ID.ContentEncodings) t.zlib = await hasZlib(r, q + c.hdr, q + c.hdr + c.size)
        q += c.hdr + c.size
      }
      if (type === 17) {
        t.lang = bcp || t.lang || 'eng' // Matroska: no Language element means English
        t.text = MKV_TEXT.test(t.codec)
        t.id = `mkv${t.num}`
        out.push(t)
      }
    }
    p += e.hdr + e.size
  }
  return out
}
// ContentEncodings > ContentEncoding > ContentCompression > ContentCompAlgo (0 = zlib)
async function hasZlib(r: Reader, from: number, to: number): Promise<boolean> {
  for (let p = from; p < to;) {
    const e = await elHeader(r, p); if (!e) return false
    if (e.id === ID.ContentEncoding || e.id === ID.ContentCompression) { if (await hasZlib(r, p + e.hdr, p + e.hdr + e.size)) return true }
    else if (e.id === ID.ContentCompAlgo) return uint(await r.copy(p + e.hdr, e.size)) === 0
    p += e.hdr + e.size
  }
  return false
}

async function scanMkv(file: Blobish, onProgress?: (frac: number) => void, signal?: AbortSignal): Promise<SubScan> {
  const r = new Reader(file)
  let p = 0, seg: El | null = null
  for (let i = 0; i < 4 && !seg; i++) { // EBML header, then Segment
    const e = await elHeader(r, p); if (!e) break
    if (e.id === ID.Segment) seg = e; else p += e.hdr + e.size
  }
  if (!seg) return { tracks: [], cues: {} }
  const segStart = p + seg.hdr
  const segEnd = seg.unknown ? file.size : Math.min(file.size, segStart + seg.size)
  let scale = 1e6, tracks: MkvTrack[] | null = null
  const byNum = new Map<number, MkvTrack>()
  const cues: Record<string, Cue[]> = {}
  for (p = segStart; p < segEnd;) {
    const e = await elHeader(r, p); if (!e) break
    const body = p + e.hdr
    const end = e.unknown ? segEnd : Math.min(segEnd, body + e.size)
    if (e.id === ID.Info) {
      for (let q = body; q < end;) {
        const c = await elHeader(r, q); if (!c) break
        if (c.id === ID.TimecodeScale) scale = uint(await r.copy(q + c.hdr, c.size))
        q += c.hdr + c.size
      }
    } else if (e.id === ID.Tracks) {
      tracks = await mkvTracks(r, body, end)
      for (const t of tracks) if (t.text) { byNum.set(t.num, t); cues[t.id] = [] }
      if (!byNum.size) return { tracks: tracks.map(strip), cues } // no text subtitle tracks: no need to scan the clusters
    } else if (e.id === ID.Cluster) {
      if (!tracks) break
      signal?.throwIfAborted()
      const cend = await scanCluster(r, body, end, e.unknown, scale, byNum, cues)
      onProgress?.(p / file.size)
      p = cend; continue
    }
    p = end
  }
  return { tracks: (tracks ?? []).map(strip), cues }
}
const strip = ({ id, lang, name, codec, forced, text }: MkvTrack): SubTrack => ({ id, lang, name, codec, forced, text })

async function scanCluster(r: Reader, from: number, to: number, unknown: boolean, scale: number, byNum: Map<number, MkvTrack>, cues: Record<string, Cue[]>): Promise<number> {
  let ctc = 0, p = from
  const block = async (pos: number, size: number, dur: number | null) => {
    const h = await r.bytes(pos, 4)
    const first = h[0]
    let n = 1; while (n <= 2 && !(first & (0x80 >> (n - 1)))) n++
    let num = first & (0xff >> n)
    for (let i = 1; i < n; i++) num = num * 256 + h[i]
    const t = byNum.get(num); if (!t) return
    const hd = await r.bytes(pos + n, 3)
    if (hd[2] & 0x06) return // laced: not used for subtitles
    let rel = (hd[0] << 8) | hd[1]; if (rel & 0x8000) rel -= 0x10000
    let payload: Uint8Array = await r.copy(pos + n + 3, size - n - 3)
    if (t.zlib) { try { payload = await inflate(payload) } catch { return } }
    const start = ((ctc + rel) * scale) / 1e9
    cues[t.id].push({ start, end: dur === null ? start + 3 : start + (dur * scale) / 1e9, text: dec.decode(payload) })
  }
  while (p < to) {
    const e = await elHeader(r, p); if (!e) break
    if (unknown && TOP.has(e.id)) break // an unknown-size cluster ends where the next top-level element starts
    const body = p + e.hdr, end = body + e.size
    if (e.id === ID.Timecode) ctc = uint(await r.copy(body, e.size))
    else if (e.id === ID.SimpleBlock) await block(body, e.size, null)
    else if (e.id === ID.BlockGroup) {
      let bpos = 0, bsize = 0, d: number | null = null
      for (let q = body; q < end;) {
        const c = await elHeader(r, q); if (!c) break
        if (c.id === ID.Block) { bpos = q + c.hdr; bsize = c.size }
        else if (c.id === ID.BlockDuration) d = uint(await r.copy(q + c.hdr, c.size))
        q += c.hdr + c.size
      }
      if (bsize) await block(bpos, bsize, d)
    }
    p = end
  }
  return p
}

// ---------------------------------------------------------------- MP4 / MOV
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 2 ** 32 + u32(b, o + 4)
const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
function boxes(b: Uint8Array, from = 0, to = b.length) {
  const out: { type: string; start: number; end: number }[] = []
  for (let p = from; p + 8 <= to;) {
    let size = u32(b, p), hdr = 8
    if (size === 1) { size = u64(b, p + 8); hdr = 16 } else if (size === 0) size = to - p
    if (size < hdr) break
    out.push({ type: fourcc(b, p + 4), start: p + hdr, end: Math.min(to, p + size) })
    p += size
  }
  return out
}
const MP4_TEXT = new Set(['tx3g', 'text', 'wvtt'])

async function scanMp4(file: Blobish): Promise<SubScan> {
  const r = new Reader(file, 1 << 12)
  let moov: Uint8Array | null = null
  for (let p = 0; p + 8 <= file.size;) {
    const h = await r.bytes(p, 16)
    let size = u32(h, 0), hdr = 8
    if (size === 1) { size = u64(h, 8); hdr = 16 } else if (size === 0) size = file.size - p
    if (size < hdr) break
    if (fourcc(h, 4) === 'moov') { moov = await r.copy(p + hdr, size - hdr); break }
    p += size
  }
  if (!moov) return { tracks: [], cues: {} }
  const tracks: SubTrack[] = [], cues: Record<string, Cue[]> = {}
  let idx = 0
  for (const trak of boxes(moov).filter(b => b.type === 'trak')) {
    const mdia = boxes(moov, trak.start, trak.end).find(b => b.type === 'mdia'); if (!mdia) continue
    const kids = boxes(moov, mdia.start, mdia.end)
    const mdhd = kids.find(b => b.type === 'mdhd'), hdlr = kids.find(b => b.type === 'hdlr'), minf = kids.find(b => b.type === 'minf')
    if (!mdhd || !hdlr || !minf) continue
    const handler = fourcc(moov, hdlr.start + 8)
    if (!['sbtl', 'text', 'subt', 'clcp'].includes(handler)) continue
    const v1 = moov[mdhd.start] === 1
    const timescale = u32(moov, mdhd.start + (v1 ? 20 : 12))
    const l = (moov[mdhd.start + (v1 ? 32 : 20)] << 8) | moov[mdhd.start + (v1 ? 33 : 21)]
    const lang = String.fromCharCode(((l >> 10) & 31) + 0x60, ((l >> 5) & 31) + 0x60, (l & 31) + 0x60)
    const stbl = boxes(moov, minf.start, minf.end).find(b => b.type === 'stbl'); if (!stbl) continue
    const st = boxes(moov, stbl.start, stbl.end)
    const get = (t: string) => st.find(b => b.type === t)
    const stsd = get('stsd'), stts = get('stts'), stsz = get('stsz'), stsc = get('stsc'), stco = get('stco') ?? get('co64')
    if (!stsd || !stts || !stsz || !stsc || !stco) continue
    const codec = fourcc(moov, stsd.start + 12)
    const t: SubTrack = { id: `mp4${idx++}`, lang: lang === 'und' ? '' : lang, name: '', codec, forced: false, text: MP4_TEXT.has(codec) }
    tracks.push(t)
    if (!t.text) continue
    // sample table -> (offset, size, time, duration)
    const n = u32(moov, stsz.start + 8), fixed = u32(moov, stsz.start + 4)
    const sizes = Array.from({ length: n }, (_, i) => (fixed ? fixed : u32(moov, stsz.start + 12 + i * 4)))
    const is64 = stco.type === 'co64', cn = u32(moov, stco.start + 4)
    const chunkOff = Array.from({ length: cn }, (_, i) => (is64 ? u64(moov, stco.start + 8 + i * 8) : u32(moov, stco.start + 8 + i * 4)))
    const scn = u32(moov, stsc.start + 4)
    const offs: number[] = []
    for (let i = 0; i < scn; i++) {
      const first = u32(moov, stsc.start + 8 + i * 12), per = u32(moov, stsc.start + 12 + i * 12)
      const next = i + 1 < scn ? u32(moov, stsc.start + 8 + (i + 1) * 12) : cn + 1
      for (let c = first; c < next && c <= cn; c++) {
        let o = chunkOff[c - 1]
        for (let k = 0; k < per && offs.length < n; k++) { offs.push(o); o += sizes[offs.length - 1] }
      }
    }
    const times: number[] = [], durs: number[] = []
    const tn = u32(moov, stts.start + 4)
    let tm = 0
    for (let i = 0; i < tn; i++) {
      const cnt = u32(moov, stts.start + 8 + i * 8), d = u32(moov, stts.start + 12 + i * 8)
      for (let k = 0; k < cnt; k++) { times.push(tm / timescale); durs.push(d / timescale); tm += d }
    }
    const list: Cue[] = []
    const wvtt = codec === 'wvtt'
    for (let i = 0; i < Math.min(n, offs.length, times.length); i += 64) {
      await Promise.all(Array.from({ length: Math.min(64, n - i) }, async (_, j) => {
        const k = i + j
        if (sizes[k] < 3) return
        const b = await r.copy(offs[k], sizes[k])
        let text = ''
        if (wvtt) { // boxes: vttc { payl } | vtte (empty)
          for (const bx of boxes(b)) if (bx.type === 'vttc') for (const q of boxes(b, bx.start, bx.end)) if (q.type === 'payl') text += (text ? '\n' : '') + dec.decode(b.subarray(q.start, q.end))
        } else {
          const len = (b[0] << 8) | b[1]
          if (!len) return
          const raw = b.subarray(2, 2 + len)
          text = raw[0] === 0xff && raw[1] === 0xfe ? new TextDecoder('utf-16le').decode(raw.subarray(2)) : raw[0] === 0xfe && raw[1] === 0xff ? new TextDecoder('utf-16be').decode(raw.subarray(2)) : dec.decode(raw)
        }
        if (text.trim()) list.push({ start: times[k], end: times[k] + durs[k], text })
      }))
    }
    cues[t.id] = list.sort((a, b) => a.start - b.start)
  }
  return { tracks, cues }
}

/** Finds the text subtitle tracks of a video file and reads their cues. Empty result = no usable soft subtitles. */
export async function scanSubtitles(file: Blobish, onProgress?: (frac: number) => void, signal?: AbortSignal): Promise<SubScan> {
  try {
    const h = new Uint8Array(await file.slice(0, 12).arrayBuffer())
    if (h[0] === 0x1a && h[1] === 0x45 && h[2] === 0xdf && h[3] === 0xa3) return await scanMkv(file, onProgress, signal)
    if (fourcc(h, 4) === 'ftyp') return await scanMp4(file)
  } catch (e) { if (signal?.aborted) throw e }
  return { tracks: [], cues: {} }
}

// ---------------------------------------------------------------- sidecar files
const ts = (s: string) => { // 00:01:02,345 | 00:01.234 | 1:02.3
  const p = s.trim().replace(',', '.').split(':').map(Number)
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : NaN
}

/** Parses SRT / WebVTT text into raw cues. */
function parseTimed(text: string): Cue[] {
  const out: Cue[] = []
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n')
    const i = lines.findIndex(l => l.includes('-->'))
    if (i < 0) continue
    const [a, b] = lines[i].split('-->')
    const start = ts(a), end = ts(b.trim().split(/\s+/)[0])
    const body = lines.slice(i + 1).join('\n')
    if (Number.isFinite(start) && Number.isFinite(end) && body.trim()) out.push({ start, end, text: body })
  }
  return out
}
/** Parses ASS/SSA `Dialogue:` lines into raw cues (text kept in the MKV block form so one cleaner handles both). */
function parseAss(text: string): Cue[] {
  const out: Cue[] = []
  let fmt: string[] = []
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (/^Format:/i.test(line) && fmt.length === 0 && /Text/i.test(line) && /Start/i.test(line)) fmt = line.slice(7).split(',').map(s => s.trim().toLowerCase())
    const m = /^Dialogue:\s*(.*)$/.exec(line)
    if (!m || !fmt.length) continue
    const f = m[1].split(','), ti = fmt.indexOf('text')
    const start = ts(f[fmt.indexOf('start')]), end = ts(f[fmt.indexOf('end')])
    if (Number.isFinite(start) && Number.isFinite(end)) out.push({ start, end, text: `0,0,x,x,0,0,0,x,${f.slice(ti).join(',')}` })
  }
  return out
}

export async function parseSidecar(f: File): Promise<SubScan> {
  const bytes = new Uint8Array(await f.arrayBuffer())
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { text = new TextDecoder('windows-1252').decode(bytes) }
  text = text.replace(/^﻿/, '')
  const ext = f.name.split('.').pop()!.toLowerCase()
  const ass = ext === 'ass' || ext === 'ssa'
  const raw = ass ? parseAss(text) : parseTimed(text)
  const track: SubTrack = { id: 'sidecar', lang: '', name: f.name, codec: ass ? 'S_TEXT/ASS' : ext === 'vtt' ? 'S_TEXT/WEBVTT' : 'S_TEXT/UTF8', forced: false, text: true }
  return { tracks: [track], cues: { sidecar: raw } }
}
export const isSidecar = (f: File) => /\.(srt|vtt|ass|ssa)$/i.test(f.name)

// ---------------------------------------------------------------- choosing, cleaning, converting
const isEnglish = (t: SubTrack) => /^en/i.test(t.lang)
const noise = (t: SubTrack) => /forced|sign|song|commentary/i.test(t.name) || t.forced
/** Preferred text track: English first, then anything; regular tracks before forced/signs-only ones. */
export function pickTrack(tracks: SubTrack[]): SubTrack | null {
  const text = tracks.filter(t => t.text)
  const rank = (t: SubTrack) => (isEnglish(t) ? 0 : 2) + (noise(t) ? 1 : 0)
  return [...text].sort((a, b) => rank(a) - rank(b))[0] ?? null
}
export function trackLabel(t: SubTrack): string {
  const code = t.lang.toLowerCase()
  let lang = ''
  if (code && code !== 'und') { try { lang = new Intl.DisplayNames(['en'], { type: 'language' }).of(code.length === 3 ? code : code.split('-')[0]) ?? code } catch { lang = code } }
  const kind = t.codec.replace('S_TEXT/', '').replace('UTF8', 'SRT').replace('ASCII', 'SRT').replace('WEBVTT', 'WebVTT')
  return [lang || t.name || 'Unknown language', t.forced ? 'forced' : '', /^(tx3g|text)$/.test(kind) ? '' : kind].filter(Boolean).join(' · ')
}

const ENT: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&nbsp;': ' ', '&quot;': '"', '&#39;': "'", '&lrm;': '', '&rlm;': '' }

/** Raw cue text -> plain spoken text ('' when nothing speakable is left). */
export function cleanText(raw: string, codec: string): string {
  let t = raw
  if (/ASS|SSA/.test(codec)) {
    const i = nth(t, ',', 8)
    t = i >= 0 ? t.slice(i + 1) : t
    if (/\{[^}]*\\p[1-9]/.test(t)) return '' // vector drawing, not text
    t = t.replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ')
  }
  t = t.replace(/<[^>]*>/g, '').replace(/&[#\w]+;/g, m => ENT[m] ?? ' ')
  t = t.replace(/[♪♫♬♩#]+/g, ' ').replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]{0,40}\)/g, ' ')
  const lines = t.split('\n').map(l => l.replace(/^\s*[-–—]+\s*/, '').replace(/^[A-Z][A-Z0-9 .'-]{1,20}:\s+/, '').replace(/^\s*[-–—]+\s*/, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  return lines.join(' ')
}
const nth = (s: string, ch: string, n: number) => { let i = -1; for (let k = 0; k < n; k++) { i = s.indexOf(ch, i + 1); if (i < 0) return -1 } return i }

/** Cleans cues and merges duplicates / overlaps (ASS tracks often repeat a line per style or effect). */
export function cleanCues(raw: Cue[], codec: string): Cue[] {
  const cues = raw.map(c => ({ start: c.start, end: Math.max(c.end, c.start + 0.3), text: cleanText(c.text, codec) })).filter(c => c.text && c.end > c.start && c.start >= 0)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const out: Cue[] = []
  for (const c of cues) {
    const p = out[out.length - 1]
    if (p && (p.text.toLowerCase() === c.text.toLowerCase()) && c.start - p.end < 0.3) { p.end = Math.max(p.end, c.end); continue } // same line again
    if (p && c.start < p.end) { // overlap with different text
      if (p.text.includes(c.text)) continue
      if (c.text.includes(p.text)) { p.text = c.text; p.end = Math.max(p.end, c.end); continue }
      if (c.start - p.start >= 0.4) p.end = c.start
      else { p.text = `${p.text} ${c.text}`; p.end = Math.max(p.end, c.end); continue } // starts together: one caption
    }
    out.push({ ...c })
  }
  return out
}

const SEC_PER_CHAR = 0.14 // longest time a cue's words are spread over: subtitles often outstay the speech

/** Whisper-shaped transcript from cues: one segment per cue, word times interpolated by character length. */
export function cuesToTranscript(cues: Cue[]): { segs: Segment[]; words: Word[] } {
  const segs: Segment[] = [], words: Word[] = []
  for (const c of cues) {
    segs.push({ start: c.start, end: c.end, text: c.text })
    const ws = c.text.split(' ').filter(Boolean)
    const total = ws.reduce((a, w) => a + w.length + 1, 0)
    const span = Math.min(c.end - c.start, Math.max(1, total * SEC_PER_CHAR))
    let at = c.start
    for (const w of ws) {
      const d = (span * (w.length + 1)) / total
      words.push({ start: at, end: at + d, text: w })
      at += d
    }
  }
  return { segs, words }
}

/** Subtitles are only trusted as the transcript when they plausibly cover the video. */
export function usable(segs: Segment[], duration: number): string | null {
  const spoken = segs.reduce((a, s) => a + (s.end - s.start), 0)
  const need = Math.max(5, duration / 120)
  if (segs.length < need) return `only ${segs.length} cue${segs.length === 1 ? '' : 's'} for ${Math.round(duration / 60)} min of video`
  if (spoken < duration * 0.03) return `the cues cover only ${(100 * spoken / duration).toFixed(1)}% of the video`
  return null
}
