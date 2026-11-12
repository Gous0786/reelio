import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation } from 'motion/react'
import * as m from 'motion/react-m'
import { AlertTriangle, Clapperboard, Crop, Database, Download, Maximize2, FilePlus2, FileVideo, RefreshCw, ScanText, Sparkles } from 'lucide-react'
import type { Clip, Loud, Segment, Word } from './lib/types'
import { findClips } from './lib/llm'
import { findRankedClips } from './lib/rank'
import { LoudnessMeter } from './lib/signals'
import { checkSupport, exportClip, openAudio, type Fit } from './lib/media'
import { cacheKey, delTranscript, getTranscript, putTranscript } from './lib/cache'
import { createPool, type WhisperModel } from './lib/transcribe'
import { detectFacecam, type FacecamSetting } from './lib/facecam'
import type { CaptionConfig } from './lib/captions'
import { facecamKey, getFacecam, putFacecam } from './lib/facecamStore'
import { dur, fmt, outName, save } from './lib/format'
import Background from './components/Background'
import CaptionControls, { useCaptionSettings } from './components/CaptionControls'
import ClipCard from './components/ClipCard'
import FacecamPanel from './components/FacecamPanel'
import DropZone from './components/DropZone'
import { EmptyIllustration } from './components/Illustrations'
import ProgressView, { NO_INFO, type RunInfo, type Stage } from './components/ProgressView'
import Segmented from './components/Segmented'
import SettingsDrawer from './components/SettingsDrawer'
import { Alert, Button, Chip, Progress, card } from './components/ui'

export default function App() {
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [stage, setStage] = useState<Stage>('idle')
  const [status, setStatus] = useState('')
  const [info, setInfo] = useState<RunInfo>(NO_INFO)
  const [error, setError] = useState<{ msg: string; retry: boolean } | null>(null)
  const [clips, setClips] = useState<Clip[]>([])
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('openrouter_key') ?? '')
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('gemini_key') ?? '')
  const [answeredBy, setAnsweredBy] = useState('')
  const [modelPref, setModelPref] = useState<'auto' | WhisperModel>('auto')
  const [workerPref, setWorkerPref] = useState<'auto' | '1' | '2' | '3'>('auto')
  const [warn, setWarn] = useState('')
  const [fit, setFit] = useState<Fit>(() => (localStorage.getItem('reelio_fit') === 'blur' ? 'blur' : 'cover'))
  const [cached, setCached] = useState(false)
  const [all, setAll] = useState<{ i: number; n: number; p: number } | null>(null) // "download all" progress
  const [allErr, setAllErr] = useState('')
  const [renders, setRenders] = useState(0) // single-clip exports in flight
  const loud = useRef<Loud | null>(null) // per-second loudness (from transcription) for the reranker
  const segments = useRef<Segment[] | null>(null) // cached transcript for LLM retry
  const [words, setWords] = useState<Word[]>([]) // word timings for the captions
  const [fc, setFc] = useState<FacecamSetting | null>(null) // facecam setting for the current video
  const [fcBusy, setFcBusy] = useState(false)
  const fcAbort = useRef<AbortController | null>(null)
  const fcRect = fc?.enabled ? fc.rect : null // set = the stacked facecam layout is on
  const [capSet, setCapSet] = useCaptionSettings()
  const captions: CaptionConfig | null = capSet.on && words.length ? { words, style: capSet.style } : null
  const unsupported = checkSupport()

  useEffect(() => { localStorage.setItem('openrouter_key', apiKey) }, [apiKey])
  useEffect(() => { localStorage.setItem('gemini_key', geminiKey) }, [geminiKey])
  useEffect(() => { localStorage.setItem('reelio_fit', fit) }, [fit])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const runClips = async (segs: Segment[], force = false) => {
    setStage('clips'); setError(null); setAnsweredBy(''); setStatus('Asking the LLM for the best moments…')
    try {
      const o = {
        apiKey: apiKey.trim() || undefined, geminiKey: geminiKey.trim() || undefined, force, maxClips: 8,
        onProgress: setStatus, onAnswered: setAnsweredBy,
      }
      setClips(await (loud.current ? findRankedClips(segs, loud.current, o) : findClips(segs, o)))
      setStage('done')
    } catch (e) {
      setError({ msg: `Finding clips failed: ${e instanceof Error ? e.message : e}`, retry: true }); setStage('error')
    }
  }

  // Facecam: restore the saved setting, else detect (runs beside transcription; failure just means "none").
  const runFacecam = async (f: File) => {
    fcAbort.current?.abort()
    const ctl = fcAbort.current = new AbortController()
    setFc(null); setFcBusy(true)
    const key = facecamKey(f)
    let s = await getFacecam(key)
    if (!s) {
      const r = await detectFacecam(f, ctl.signal)
      s = { rect: r?.rect ?? null, enabled: !!r, confidence: r?.confidence ?? 0, detected: !!r }
      if (r !== undefined && !ctl.signal.aborted) putFacecam(key, s)
    }
    if (ctl.signal.aborted) return
    setFc(s); setFcBusy(false)
  }
  const setFacecam = (s: FacecamSetting) => { setFc(s); if (file) putFacecam(facecamKey(file), s) }

  const start = async (f: File, force = false) => {
    void runFacecam(f)
    setFile(f); setUrl(URL.createObjectURL(f)); setClips([]); setError(null); setWarn(''); setCached(false); setAllErr(''); setAnsweredBy(''); segments.current = null; setWords([]); loud.current = null; setInfo(NO_INFO)
    let audio: Awaited<ReturnType<typeof openAudio>> | null = null
    let tr: Awaited<ReturnType<typeof createPool>> | null = null
    try {
      setStage('model'); setStatus('Opening file…')
      audio = await openAudio(f)
      const model: WhisperModel = modelPref !== 'auto' ? modelPref : 'onnx-community/whisper-tiny'
      const mname = model.split('/')[1]
      setInfo(i => ({ ...i, model: mname }))
      const key = cacheKey(f, model)
      if (force) await delTranscript(key)
      else {
        const hit = await getTranscript(key)
        if (hit?.segs.length) { segments.current = hit.segs; loud.current = hit.loud; setWords(hit.words ?? []); setCached(true); await runClips(hit.segs); return }
      }
      setStatus(`Downloading ${mname}… 0%`)
      tr = await createPool(model, workerPref === 'auto' ? 'auto' : Number(workerPref), p => { setStatus(`Downloading ${mname}… ${p}%`); setInfo(i => ({ ...i, download: p })) })
      const pool = tr.workers
      const device = `${mname}${pool.length > 1 ? ` × ${pool.length} workers` : ''} · ` + (tr.device === 'webgpu' ? `WebGPU${tr.gpu ? ` (${tr.gpu})` : ''}` : 'WASM (CPU, slower)')
      setInfo(i => ({ ...i, workers: pool.length, device: tr!.device === 'webgpu' ? 'WebGPU' : 'WASM (CPU, slower)', gpu: tr!.gpu || null }))
      if (tr.device === 'webgpu' && /intel/i.test(tr.gpu))
        setWarn('Running on the Intel iGPU. For the NVIDIA GPU: Windows Settings › Display › Graphics › Chrome › High performance, then restart Chrome.')
      setStage('transcribe')
      const segs: Segment[] = [], wds: Word[] = []
      const meter = new LoudnessMeter()
      const t0 = Date.now()
      let done = 0, skipped = 0, partial = false
      const report = () => {
        const el = (Date.now() - t0) / 1000
        const left = done > 0 ? ((audio!.duration - done) * el) / done : 0
        setStatus(`Transcribing… ${Math.min(100, Math.round((done / audio!.duration) * 100))}% · ${dur(el)} elapsed${done > 0 ? ` · ~${dur(left)} left · ${(done / el).toFixed(1)}× realtime` : ''} · ${device}`)
        setInfo(i => ({ ...i, pct: Math.min(100, Math.round((done / audio!.duration) * 100)), elapsed: el, left: done > 0 ? left : null, speed: done > 0 ? done / el : null }))
      }
      report()
      // One lane per worker. Lanes pull the next slice only when their worker is idle, so at most one slice per
      // worker (plus the generator's own buffer) is in memory. Segments arrive out of order; sorted below.
      const it = audio.slices()
      let fatal: unknown = null
      const lane = async (w: (typeof pool)[number]) => {
        for (;;) {
          const { value: sl, done: end } = await it.next()
          if (end) return
          const len = sl.audio.length / 16000
          meter.add(sl.audio, sl.offset) // before the buffer is handed to the worker
          let buf = sl.audio
          try {
            for (let attempt = 0; ; attempt++) { // one retry per slice, then skip it
              try { const r = await w.run(buf, sl.offset); segs.push(...r.segments); wds.push(...r.words); break } catch (e) {
                const back = (e as { audio?: Float32Array }).audio
                if (!back) throw e // worker died: this lane stops
                if (attempt === 1) { skipped++; break }
                buf = back
              }
            }
          } catch (e) { fatal ??= e; return }
          done += len; report()
        }
      }
      await Promise.all(pool.map(lane))
      segs.sort((x, y) => x.start - y.start); wds.sort((x, y) => x.start - y.start)
      if (fatal) {
        if (!segs.length) throw fatal
        partial = true
        setWarn(`A transcription worker stopped (${fatal instanceof Error ? fatal.message : fatal}) after ${fmt(done)} of audio; clips use the partial transcript.`)
      }
      if (skipped) setWarn(w => w || `${skipped} audio slice(s) failed and were skipped.`)
      if (!segs.length) throw new Error('No speech was detected in this video.')
      segments.current = segs; setWords(wds)
      loud.current = meter.finish()
      if (!partial && !skipped) await putTranscript(key, { segs, loud: loud.current, words: wds })
      await runClips(segs, force)
    } catch (e) {
      setError({ msg: e instanceof Error ? e.message : String(e), retry: false }); setStage('error')
    } finally { tr?.close(); audio?.close() }
  }

  const reset = () => { fcAbort.current?.abort(); setFc(null); setFcBusy(false); setWarn(''); setCached(false); setAnsweredBy(''); setAllErr(''); setFile(null); setUrl(''); setStage('idle'); setClips([]); setError(null); setInfo(NO_INFO); segments.current = null; setWords([]); loud.current = null }
  const busy = stage === 'model' || stage === 'transcribe' || stage === 'clips'
  const trim = (i: number, t: { start: number; end: number }) => setClips(cs => cs.map((c, j) => (j === i ? { ...c, ...t } : c)))
  const downloadAll = async () => {
    setAllErr('')
    for (let i = 0; i < clips.length; i++) {
      try {
        const blob = await exportClip(file!, clips[i].start, clips[i].end, fit, p => setAll({ i, n: clips.length, p }), fcRect, captions)
        save(blob, outName(file!, i + 1))
      } catch (e) { setAllErr(`Clip ${i + 1}: ${e instanceof Error ? e.message : e}`); break }
    }
    setAll(null)
  }
  const onFiles = (f: File) => { if (!busy) start(f) }
  const gpuBusy = busy || all !== null || renders > 0
  const allPct = all ? Math.round(((all.i + all.p / 100) / all.n) * 100) : 0

  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation} strict>
        <Background paused={gpuBusy} />
        <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pt-5 pb-16 sm:px-6">
          <header className="flex items-center justify-between gap-3 pb-6">
            <button type="button" onClick={() => !busy && reset()} className="group flex items-center gap-3 rounded-2xl" aria-label="Reelio home">
              <span className="grid size-10 place-items-center rounded-2xl bg-linear-to-br from-violet-500 to-fuchsia-500 text-white shadow-lg shadow-violet-900/40">
                <Clapperboard className="size-5" aria-hidden />
              </span>
              <span className="text-left">
                <span className="font-display block text-xl leading-none font-semibold tracking-tight text-white">Reelio</span>
                <span className="hidden text-xs text-zinc-400 sm:block">Long video to ranked shorts</span>
              </span>
            </button>
            <SettingsDrawer {...{ geminiKey, apiKey, modelPref, workerPref, fit, setGeminiKey, setApiKey, setModelPref, setWorkerPref, setFit }} />
          </header>

          <main className="flex flex-1 flex-col gap-5">
            {unsupported && <Alert tone="error" title="Browser not supported">{unsupported}</Alert>}

            <AnimatePresence mode="wait" initial={false}>
              {stage === 'idle' && !unsupported && (
                <m.div key="idle" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.25 }}>
                  <DropZone onFile={onFiles} />
                </m.div>
              )}
            </AnimatePresence>

            {file && stage !== 'idle' && (
              <m.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`${card} flex flex-wrap items-center justify-between gap-3 p-3.5 sm:p-4`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/8 text-violet-200"><FileVideo className="size-5" aria-hidden /></span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white" title={file.name}>{file.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Chip>{(file.size / 1048576).toFixed(file.size > 1e9 ? 0 : 1)} MB</Chip>
                      {stage === 'done' && <Chip tone="accent"><Sparkles className="size-3" aria-hidden />{clips.length} clip{clips.length === 1 ? '' : 's'}</Chip>}
                      {cached && stage !== 'model' && <Chip tone="good"><Database className="size-3" aria-hidden />Transcript from cache</Chip>}
                      {answeredBy && stage === 'done' && <Chip className="max-w-full"><span className="truncate" title={answeredBy}>via {answeredBy}</span></Chip>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!busy && segments.current && (
                    <Button size="sm" title="Ask the LLM again, ignoring the cached clip result" icon={<RefreshCw className="size-3.5" />} onClick={() => runClips(segments.current!, true)}>Find clips again</Button>
                  )}
                  {!busy && (
                    <Button size="sm" title="Ignore the cached transcript and transcribe again" icon={<ScanText className="size-3.5" />} onClick={() => start(file, true)}>Re-transcribe</Button>
                  )}
                  <Button size="sm" variant="ghost" icon={<FilePlus2 className="size-3.5" />} onClick={reset}>New video</Button>
                </div>
              </m.section>
            )}

            {file && stage !== 'idle' && <FacecamPanel url={url} setting={fc} detecting={fcBusy} onChange={setFacecam} />}

            {busy && (
              <m.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <ProgressView stage={stage} status={status} info={info} />
              </m.div>
            )}

            {warn && <Alert tone="warn" title="Heads up"><span className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{warn}</span></Alert>}

            {error && (
              <Alert
                tone="error" title={error.retry ? 'Could not find clips' : 'Something went wrong'}
                actions={<>
                  {error.retry && segments.current && <Button variant="danger" size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => runClips(segments.current!, true)}>Retry (transcript is cached)</Button>}
                  {!error.retry && <Button variant="danger" size="sm" icon={<FilePlus2 className="size-3.5" />} onClick={reset}>Try another video</Button>}
                </>}
              >{error.msg}</Alert>
            )}

            {stage === 'clips' && (
              <div className="grid gap-5 lg:grid-cols-2" aria-hidden>
                {[0, 1].map(i => (
                  <div key={i} className={`${card} flex gap-5 p-5`}>
                    <div className="animate-shimmer aspect-9/16 w-[40%] max-w-47.5 rounded-2xl bg-[linear-gradient(90deg,#ffffff0a,#ffffff18,#ffffff0a)] bg-[length:200%_100%]" />
                    <div className="flex flex-1 flex-col gap-3">
                      {[60, 90, 75, 40].map((w, j) => <div key={j} className="h-3 rounded-full bg-white/8" style={{ width: `${w}%` }} />)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {stage === 'done' && (
              <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-5">
                {clips.length > 0 && (
                  <section className={`${card} flex flex-col gap-3 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4`} aria-label="Export options">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-medium text-zinc-200">Framing</span>
                      {fcRect && <Chip tone="accent">Facecam layout is on</Chip>}
                      <Segmented label="Framing" value={fcRect ? 'cover' : fit} onChange={setFit} disabled={!!fcRect} options={[
                        { value: 'cover', label: <><Crop className="size-3.5" />Centre crop</>, hint: 'Fill the 9:16 frame' },
                        { value: 'blur', label: <><Maximize2 className="size-3.5" />Fit + blur</>, hint: 'Whole picture over a blurred background' },
                      ]} />
                      <CaptionControls value={capSet} onChange={setCapSet} available={words.length > 0} />
                    </div>
                    <div className="flex min-w-0 flex-col gap-2 sm:w-72">
                      {all && (
                        <div>
                          <div className="mb-1 flex justify-between text-xs text-zinc-300 tabular-nums">
                            <span>Rendering clip {all.i + 1}/{all.n} · {all.p}%</span><span>overall {allPct}%</span>
                          </div>
                          <Progress value={allPct} />
                        </div>
                      )}
                      <Button variant="primary" disabled={all !== null || renders > 0} onClick={downloadAll} icon={<Download className="size-4" />}>
                        {all ? 'Rendering…' : `Download all (${clips.length})`}
                      </Button>
                    </div>
                  </section>
                )}
                {allErr && <Alert tone="error">{allErr}</Alert>}

                {clips.length === 0 && (
                  <div className={`${card} flex flex-col items-center gap-3 px-6 py-12 text-center`}>
                    <EmptyIllustration className="w-40" />
                    <h2 className="font-display text-xl font-semibold text-white">No clips found</h2>
                    <p className="max-w-sm text-sm text-zinc-400">The model did not pick any moments. Try a video with more spoken content, or ask again.</p>
                    {segments.current && <Button variant="primary" icon={<RefreshCw className="size-4" />} onClick={() => runClips(segments.current!, true)}>Find clips again</Button>}
                  </div>
                )}

                <section className="grid gap-5 lg:grid-cols-2" aria-label="Clips">
                  {clips.map((c, i) => (
                    <m.div key={i} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 5) * 0.05, duration: 0.3 }}>
                      <ClipCard rank={i + 1} clip={c} file={file!} url={url} fit={fcRect ? 'cover' : fit} fc={fcRect} captions={captions} locked={all !== null}
                        onTrim={t => trim(i, t)} onRendering={a => setRenders(n => Math.max(0, n + (a ? 1 : -1)))} />
                    </m.div>
                  ))}
                </section>
              </m.div>
            )}
          </main>

          <footer className="pt-10 text-center text-xs text-zinc-500">Video and audio stay on your device. Only the transcript text is sent to the LLM.</footer>
        </div>
      </LazyMotion>
    </MotionConfig>
  )
}
