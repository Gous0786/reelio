import { useEffect, useRef, useState } from 'react'
import type { Clip, Segment } from './lib/types'
import { findClips } from './lib/llm'
import { checkSupport, exportClip, openAudio, type Fit } from './lib/media'
import { cacheKey, delTranscript, getTranscript, putTranscript } from './lib/cache'
import { createTranscriber, type WhisperModel } from './lib/transcribe'

type Stage = 'idle' | 'model' | 'transcribe' | 'clips' | 'done' | 'error'
const STAGES: [Stage, string][] = [['model', 'Loading speech model'], ['transcribe', 'Extracting audio & transcribing'], ['clips', 'Finding clips']]
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const fmt1 = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const outName = (f: File, rank: number) => `${f.name.replace(/\.[^.]+$/, '')}-clip${rank}.mp4`
function save(blob: Blob, name: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 10000)
}
const dur = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ` : '') + `${Math.floor((s % 3600) / 60)}m ${Math.round(s % 60)}s`

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [status, setStatus] = useState('')
  const [error, setError] = useState<{ msg: string; retry: boolean } | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('openrouter_key') ?? '')
  const [modelPref, setModelPref] = useState<'auto' | WhisperModel>('auto')
  const [warn, setWarn] = useState('')
  const [fit, setFit] = useState<Fit>(() => (localStorage.getItem('reelio_fit') === 'blur' ? 'blur' : 'cover'))
  const [cached, setCached] = useState(false)
  const [all, setAll] = useState<string | null>(null) // "download all" progress text
  const [allErr, setAllErr] = useState('')
  const segments = useRef<Segment[] | null>(null) // cached transcript for LLM retry
  const unsupported = checkSupport()

  useEffect(() => { localStorage.setItem('openrouter_key', apiKey) }, [apiKey])
  useEffect(() => { localStorage.setItem('reelio_fit', fit) }, [fit])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const runClips = async (segs: Segment[]) => {
    setStage('clips'); setError(null); setStatus('Asking the LLM for the best moments…')
    try {
      setClips(await findClips(segs, { apiKey: apiKey.trim() || undefined, maxClips: 8, onProgress: setStatus }))
      setStage('done')
    } catch (e) {
      setError({ msg: `Finding clips failed: ${e instanceof Error ? e.message : e}`, retry: true }); setStage('error')
    }
  }

  const start = async (f: File, force = false) => {
    setFile(f); setUrl(URL.createObjectURL(f)); setClips([]); setError(null); setWarn(''); setCached(false); setAllErr(''); segments.current = null
    let audio: Awaited<ReturnType<typeof openAudio>> | null = null
    let tr: Awaited<ReturnType<typeof createTranscriber>> | null = null
    try {
      setStage('model'); setStatus('Opening file…')
      audio = await openAudio(f)
      // tiny is ~2x faster; worth the accuracy loss only on long videos
      const model: WhisperModel = modelPref !== 'auto' ? modelPref
        : audio.duration > 1800 ? 'onnx-community/whisper-tiny' : 'onnx-community/whisper-base'
      const mname = model.split('/')[1]
      const key = cacheKey(f, model)
      if (force) await delTranscript(key)
      else {
        const hit = await getTranscript(key)
        if (hit?.length) { segments.current = hit; setCached(true); await runClips(hit); return }
      }
      setStatus(`Downloading ${mname}… 0%`)
      tr = await createTranscriber(model, p => setStatus(`Downloading ${mname}… ${p}%`))
      const device = `${mname} · ` + (tr.device === 'webgpu' ? `WebGPU${tr.gpu ? ` (${tr.gpu})` : ''}` : 'WASM (CPU, slower)')
      if (tr.device === 'webgpu' && /intel/i.test(tr.gpu))
        setWarn('Running on the Intel iGPU. For the NVIDIA GPU: Windows Settings › Display › Graphics › Chrome › High performance, then restart Chrome.')
      setStage('transcribe')
      const segs: Segment[] = []
      const t0 = Date.now()
      let done = 0, skipped = 0, partial = false
      const report = () => {
        const el = (Date.now() - t0) / 1000
        const left = done > 0 ? ((audio!.duration - done) * el) / done : 0
        setStatus(`Transcribing… ${Math.min(100, Math.round((done / audio!.duration) * 100))}% · ${dur(el)} elapsed${done > 0 ? ` · ~${dur(left)} left · ${(done / el).toFixed(1)}× realtime` : ''} · ${device}`)
      }
      report()
      try {
        for await (const sl of audio.slices()) {
          const len = sl.audio.length / 16000
          let buf = sl.audio
          for (let attempt = 0; ; attempt++) { // one retry per slice, then skip it
            try { segs.push(...(await tr.run(buf, sl.offset))); break } catch (e) {
              const back = (e as { audio?: Float32Array }).audio
              if (!back) throw e // worker died: cannot continue
              if (attempt === 1) { skipped++; break }
              buf = back
            }
          }
          done = sl.offset + len; report()
        }
      } catch (e) {
        if (!segs.length) throw e
        partial = true
        setWarn(`Transcription stopped at ${fmt(done)} (${e instanceof Error ? e.message : e}); clips use the partial transcript.`)
      }
      if (skipped) setWarn(w => w || `${skipped} audio slice(s) failed and were skipped.`)
      if (!segs.length) throw new Error('No speech was detected in this video.')
      segments.current = segs
      if (!partial && !skipped) await putTranscript(key, segs)
      await runClips(segs)
    } catch (e) {
      setError({ msg: e instanceof Error ? e.message : String(e), retry: false }); setStage('error')
    } finally { tr?.close(); audio?.close() }
  }

  const reset = () => { setWarn(''); setCached(false); setAllErr(''); setFile(null); setUrl(''); setStage('idle'); setClips([]); setError(null); segments.current = null }
  const busy = stage === 'model' || stage === 'transcribe' || stage === 'clips'
  const trim = (i: number, t: { start: number; end: number }) => setClips(cs => cs.map((c, j) => (j === i ? { ...c, ...t } : c)))
  const downloadAll = async () => {
    setAllErr('')
    for (let i = 0; i < clips.length; i++) {
      try {
        const blob = await exportClip(file!, clips[i].start, clips[i].end, fit, p =>
          setAll(`Rendering clip ${i + 1}/${clips.length} · ${p}% · overall ${Math.round(((i + p / 100) / clips.length) * 100)}%`))
        save(blob, outName(file!, i + 1))
      } catch (e) { setAllErr(`Clip ${i + 1}: ${e instanceof Error ? e.message : e}`); break }
    }
    setAll(null)
  }
  const onFiles = (fl: FileList | null) => { const f = fl?.[0]; if (f && !busy) start(f) }

  return (
    <main>
      <header>
        <h1>Reelio</h1>
        <p>Drop a long video, get ranked vertical clips. Everything runs in your browser.</p>
      </header>

      {unsupported && <div className="error">{unsupported}</div>}

      {stage === 'idle' && !unsupported && (
        <>
          <label className="drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); onFiles(e.dataTransfer.files) }}>
            <input type="file" accept="video/*,audio/*" hidden onChange={e => onFiles(e.target.files)} />
            <strong>Drop a video here</strong>
            <span>or click to choose a file</span>
          </label>
          <details>
            <summary>Settings</summary>
            <label>OpenRouter API key (optional)
              <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-or-… (empty = use /api/chat proxy)" />
            </label>
            <label>Speech model
              <select value={modelPref} onChange={e => setModelPref(e.target.value as 'auto' | WhisperModel)}>
                <option value="auto">auto (tiny for videos over 30 min, else base)</option>
                <option value="onnx-community/whisper-base">whisper-base (better)</option>
                <option value="onnx-community/whisper-tiny">whisper-tiny (faster)</option>
              </select>
            </label>
          </details>
        </>
      )}

      {file && stage !== 'idle' && (
        <div className="bar">
          <span className="name">{file.name}</span>
          <span className="actions">
            {!busy && <button className="ghost" title="Ignore the cached transcript and transcribe again" onClick={() => start(file, true)}>Re-transcribe</button>}
            <button className="ghost" onClick={reset}>New video</button>
          </span>
        </div>
      )}

      {busy && (
        <ol className="stages">
          {STAGES.map(([s, label], i) => {
            const cur = STAGES.findIndex(x => x[0] === stage)
            return <li key={s} className={i < cur ? 'done' : i === cur ? 'active' : ''}>{label}{i === cur && <small>{status}</small>}</li>
          })}
        </ol>
      )}

      {cached && stage !== 'model' && <p className="note">Transcript loaded from cache (no transcription needed).</p>}
      {warn && <div className="error">{warn}</div>}

      {error && (
        <div className="error">
          <p style={{ whiteSpace: 'pre-line' }}>{error.msg}</p>
          {error.retry && segments.current && <button onClick={() => runClips(segments.current!)}>Retry (transcript is cached)</button>}
          {!error.retry && <button onClick={reset}>Try another video</button>}
        </div>
      )}

      {stage === 'done' && (
        <>
          {clips.length > 0 && (
            <div className="toolbar">
              <label>Framing
                <select value={fit} onChange={e => setFit(e.target.value as Fit)}>
                  <option value="cover">Centre crop</option>
                  <option value="blur">Fit with blurred background</option>
                </select>
              </label>
              <button disabled={all !== null} onClick={downloadAll}>{all ?? `Download all (${clips.length})`}</button>
            </div>
          )}
          {allErr && <p className="err">{allErr}</p>}
          <section className="grid">
            {clips.length === 0 && <p>No clips were found. Try a video with more spoken content.</p>}
            {clips.map((c, i) => <ClipCard key={i} rank={i + 1} clip={c} file={file!} url={url} fit={fit} locked={all !== null} onTrim={t => trim(i, t)} />)}
          </section>
        </>
      )}
    </main>
  )
}

function ClipCard({ rank, clip, file, url, fit, locked, onTrim }: {
  rank: number; clip: Clip; file: File; url: string; fit: Fit; locked: boolean; onTrim: (t: { start: number; end: number }) => void
}) {
  const vid = useRef<HTMLVideoElement>(null)
  const bg = useRef<HTMLVideoElement>(null) // blurred copy behind the video in 'blur' mode, kept in sync
  const [playing, setPlaying] = useState(false)
  const [pct, setPct] = useState<number | null>(null)
  const [err, setErr] = useState('')
  const [copied, setCopied] = useState(false)

  const toggle = () => {
    const v = vid.current!
    if (!v.paused) return v.pause()
    if (v.currentTime < clip.start || v.currentTime >= clip.end - 0.1) v.currentTime = clip.start
    v.play()
  }
  const nudge = (which: 'start' | 'end', d: number) => {
    const max = Number.isFinite(vid.current?.duration) ? vid.current!.duration : Infinity
    let { start, end } = clip
    if (which === 'start') start = Math.max(0, Math.min(start + d, end - 1))
    else end = Math.min(max, Math.max(end + d, start + 1))
    onTrim({ start, end })
    if (vid.current) vid.current.currentTime = which === 'start' ? start : Math.max(start, end - 2) // show the edited edge
  }
  const download = async () => {
    setErr(''); setPct(0)
    try { save(await exportClip(file, clip.start, clip.end, fit, setPct), outName(file, rank)) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setPct(null)
  }
  const copy = async () => {
    await navigator.clipboard.writeText([clip.caption, clip.hashtags?.join(' ')].filter(Boolean).join('\n\n'))
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  const sync = (v: HTMLVideoElement) => {
    const b = bg.current
    if (b && Math.abs(b.currentTime - v.currentTime) > 0.25) b.currentTime = v.currentTime
  }
  const trimRow = (which: 'start' | 'end') => (
    <span className="trim">{which} {fmt1(clip[which])}
      <button className="ghost" onClick={() => nudge(which, -0.5)} title={`${which} -0.5 s`}>−</button>
      <button className="ghost" onClick={() => nudge(which, 0.5)} title={`${which} +0.5 s`}>+</button>
    </span>
  )

  return (
    <article className="card">
      <div className={`phone ${fit}`} onClick={toggle}>
        {fit === 'blur' && <video ref={bg} className="bgv" src={`${url}#t=${clip.start}`} muted preload="metadata" playsInline />}
        <video ref={vid} className="main" src={`${url}#t=${clip.start}`} preload="metadata" playsInline
          onPlay={() => { setPlaying(true); bg.current?.play().catch(() => {}) }}
          onPause={() => { setPlaying(false); bg.current?.pause() }}
          onSeeked={e => sync(e.currentTarget)}
          onTimeUpdate={e => {
            const v = e.currentTarget
            if (v.currentTime >= clip.end) { v.pause(); v.currentTime = clip.start } else sync(v)
          }} />
        {!playing && <span className="play">▶</span>}
      </div>
      <div className="info">
        <div className="top"><span className="score">{Math.round(clip.score)}</span><span className="dur">#{rank} · {(clip.end - clip.start).toFixed(1)}s</span></div>
        <div className="trims">{trimRow('start')}{trimRow('end')}</div>
        <h3>{clip.title}</h3>
        <p className="hook">“{clip.hook}”</p>
        <p className="reason">{clip.reason}</p>
        {(clip.caption || clip.hashtags?.length) && (
          <div className="caption">
            {clip.caption && <p>{clip.caption}</p>}
            {clip.hashtags?.length ? <p className="tags">{clip.hashtags.join(' ')}</p> : null}
            <button className="ghost" onClick={copy}>{copied ? 'Copied' : 'Copy caption'}</button>
          </div>
        )}
        <button disabled={pct !== null || locked} onClick={download}>{pct === null ? 'Download MP4' : `Rendering… ${pct}%`}</button>
        {err && <p className="err">{err}</p>}
      </div>
    </article>
  )
}
