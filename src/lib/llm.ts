import type { Clip, FindClipsOptions, Segment } from './types';
import { getClips, putClips } from './cache';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PROXY_URL = '/api/chat';
const FALLBACK_CHARS = 45000; // chunk size for small-context models
const OPENROUTER_MAX_CHARS = 150000; // cap per request on free models (slow/flaky with huge prompts)
const CHARS_PER_TOKEN = 3; // conservative for timestamped transcript lines
export const PROMPT_VERSION = 'v4-rank'; // bump when the prompt/output format changes: invalidates cached clip results
// Gemini (tried first when a key is set): native generateContent, JSON mode, 1M-token context.
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse`;
const GEMINI_CHARS = 400000; // ~130k tokens: a 3-hour transcript (~110k chars) fits in one request
const GEMINI_FIRST_TOKEN_MS = 30000; // no first token by then = give up and fall through
const GEMINI_STALL_MS = 30000; // silence after the first token
const GEMINI_TIMEOUT_MS = 180000;
const MAX_ATTEMPTS = 6;
const ATTEMPT_TIMEOUT_MS = 240000; // hard cap per model; streaming shows progress meanwhile
const STALL_MS = 60000; // no bytes at all (not even keepalives) for this long = dead connection
const MIN_LEN = 15;
const MAX_LEN = 90;
// Substrings of model ids, strongest general-purpose models first.
const PREFERENCE = [
  'nemotron-3.5-super', 'gemma-4', 'llama-3.3-70b', 'qwen3', 'gemma-3-27b', 'mistral-small', 'nemotron-3-ultra',
  'llama-3.1-405b', 'deepseek', 'gemma', 'qwen', 'llama', 'mistral', 'nemotron',
];
// Tiny or slow-reasoning models that waste an attempt.
const AVOID = /lfm-|lightning|nano|code/;

interface ModelInfo { id: string; json: boolean; ctx: number }
let modelsCache: Promise<ModelInfo[]> | null = null;
const deadModels = new Set<string>(); // 403/404 this session: never retry
const GOOD_KEY = 'reelio_good_model'; // last free model that returned valid clips; tried first next time

function loadModels(): Promise<ModelInfo[]> {
  if (!modelsCache) {
    modelsCache = fetch(MODELS_URL)
      .then(r => {
        if (!r.ok) throw new Error(`model list HTTP ${r.status}`);
        return r.json();
      })
      .then((j: { data?: { id: string; context_length?: number; supported_parameters?: string[] }[] }) => {
        const rank = (id: string) => {
          const i = PREFERENCE.findIndex(p => id.includes(p));
          return i < 0 ? PREFERENCE.length : i;
        };
        const ids = (j.data ?? [])
          .filter(m => m.id.endsWith(':free') && (m.context_length ?? 0) >= 32000 && !AVOID.test(m.id))
          .map(m => ({ id: m.id, json: !!m.supported_parameters?.includes('response_format'), ctx: m.context_length ?? 0 }))
          .sort((a, b) => rank(a.id) - rank(b.id));
        if (!ids.length) throw new Error('no free models available');
        return ids;
      })
      .catch(err => {
        modelsCache = null;
        throw err;
      });
  }
  return modelsCache;
}

export const formatLine = (s: Segment) =>
  `[${Math.round(s.start)}-${Math.round(s.end)}] ${s.text.replace(/\s+/g, ' ').trim()}`;

function buildPrompt(text: string, n: number, part?: string): string {
  return [
    `Transcript${part ? ` (${part} of a longer video)` : ''}, one line per segment as [start-end] text, times in seconds:`,
    text,
    '',
    n >= 10
      ? `Pick ${Math.round(n * 0.8)} to ${n} candidate short-form clips (YouTube Shorts / Reels) from this transcript. Include weaker candidates too: they are re-scored later, so do not stop early.`
      : `Pick up to ${n} of the best short-form clips (YouTube Shorts / Reels) from this transcript.`,
    'Each clip must:',
    '- be 20-60 seconds long, starting at a segment start and ending at a segment end;',
    '- open with a hook-first moment and make sense without any outside context;',
    '- be a self-contained moment, not a fragment.',
    'Score each clip 0-100 for virality: hook strength, emotional payoff, standalone clarity, shareability.',
    'Reply with strict JSON only, no prose and no code fences:',
    'For each clip also write "caption" (a short engaging post caption, under 150 characters) and "hashtags" (3-5 relevant hashtags, each starting with #).',
    '{"clips":[{"start":0.0,"end":0.0,"title":"","hook":"","reason":"","score":0,"caption":"","hashtags":["#"]}]}',
  ].join('\n');
}

// Extracts the first JSON object (from first "{" to last "}"), which also drops code fences and <think> blocks.
export function parseClips(text: string): unknown[] | null {
  const body = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  // Some models answer with a bare array [ {...}, ... ] instead of {"clips":[...]}: take whichever opens first.
  const a = body.indexOf('[');
  const o = body.indexOf('{');
  const arr = a >= 0 && (o < 0 || a < o);
  const start = arr ? a : o;
  const end = body.lastIndexOf(arr ? ']' : '}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(body.slice(start, end + 1)) as { clips?: unknown };
    if (Array.isArray(obj)) return obj;
    return Array.isArray(obj.clips) ? obj.clips : null;
  } catch {
    const items = salvage(body);
    return items.length ? items : null;
  }
}

// Malformed JSON (seen from Gemini flash-lite: an array closed too early plus a stray key): keep every complete
// flat object that has a numeric "start" or "id" (clip / rerank entry) instead of rejecting the whole answer.
function salvage(body: string): unknown[] {
  const out: unknown[] = [];
  const open: number[] = [];
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') open.push(i);
    else if (ch === '}' && open.length) {
      const from = open.pop()!;
      try {
        const o = JSON.parse(body.slice(from, i + 1)) as Record<string, unknown>;
        if (o && typeof o === 'object' && (typeof o.start === 'number' || typeof o.id === 'number')) out.push(o);
      } catch { /* not a complete object */ }
    }
  }
  return out;
}

class Fatal extends Error {} // quota/auth problems: trying other models cannot help

// OpenRouter errors look like {error:{message, code, metadata:{raw, provider_name}}}; surface the real cause.
function describeError(status: number, body: string): string {
  let msg = body.slice(0, 200);
  try {
    const e = (JSON.parse(body) as { error?: { message?: string; metadata?: { raw?: unknown; provider_name?: string } } }).error;
    if (e) {
      const raw = typeof e.metadata?.raw === 'string' ? e.metadata.raw : '';
      msg = (raw || e.message || msg).replace(/https?:\/\/\S+/g, '').replace(/[:,]\s*$/, '').trim();
      if (e.metadata?.provider_name) msg += ` [${e.metadata.provider_name}]`;
    }
  } catch { /* not JSON */ }
  return `HTTP ${status}: ${msg}`;
}

type Delta = { error?: { code?: number }; choices?: { delta?: { content?: string; reasoning?: string }; finish_reason?: string }[] };

// Streams one completion and returns the answer text; throws with a readable cause on failure.
async function callModel(m: ModelInfo, prompt: string, opts: FindClipsOptions, label: string, noThink: boolean): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  const ctrl = new AbortController();
  const hard = setTimeout(() => ctrl.abort(new Error(`no answer within ${ATTEMPT_TIMEOUT_MS / 1000}s`)), ATTEMPT_TIMEOUT_MS);
  let stall: ReturnType<typeof setTimeout> | undefined;
  const alive = () => {
    clearTimeout(stall);
    stall = setTimeout(() => ctrl.abort(new Error(`connection stalled for ${STALL_MS / 1000}s`)), STALL_MS);
  };
  const t0 = Date.now();
  try {
    alive();
    const res = await fetch(opts.apiKey ? CHAT_URL : PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: m.id,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 16000,
        stream: true,
        // Free models are all reasoning models; thinking over a long transcript takes minutes, so turn it off.
        reasoning: noThink ? { enabled: false } : { effort: 'low' },
        ...(m.json ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw Object.assign(new Error(describeError(res.status, await res.text())), { status: res.status });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', content = '', thinking = false, finish = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      alive();
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue; // ": OPENROUTER PROCESSING" keepalives
        const d = line.slice(5).trim();
        if (d === '[DONE]') continue;
        let j: Delta;
        try { j = JSON.parse(d); } catch { continue; }
        if (j.error) throw Object.assign(new Error(describeError(j.error.code ?? 200, d)), { status: j.error.code });
        const ch = j.choices?.[0];
        if (ch?.delta?.reasoning) thinking = true;
        if (ch?.delta?.content) content += ch.delta.content;
        if (ch?.finish_reason) finish = ch.finish_reason;
      }
      const s = Math.round((Date.now() - t0) / 1000);
      const what = content ? `writing answer (${content.length} chars)` : thinking ? 'thinking' : 'reading transcript';
      opts.onProgress?.(`${label}: ${m.id} ${what}… ${s}s`);
    }
    if (!content.trim()) {
      throw new Error(finish === 'length' ? 'spent its whole token budget thinking, no answer' : `empty answer (finish_reason ${finish || 'none'})`);
    }
    return content;
  } catch (e) {
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof Error) throw ctrl.signal.reason;
    throw e;
  } finally {
    clearTimeout(hard);
    clearTimeout(stall);
  }
}

// Characters of transcript a model can take in one request (reserves ~16k tokens for the answer + prompt overhead).
const budget = (m: ModelInfo) => Math.min(OPENROUTER_MAX_CHARS, Math.max(0, (m.ctx - 17000) * CHARS_PER_TOKEN));

// Remembered model first (stable sort: the rest keep their order).
async function candidates(): Promise<ModelInfo[]> {
  const good = localStorage.getItem(GOOD_KEY);
  return (await loadModels()).filter(m => !deadModels.has(m.id)).sort((a, b) => Number(b.id === good) - Number(a.id === good));
}

let geminiOffUntil = 0; // after a Gemini failure it is skipped until then (Infinity = bad key / daily quota: until reload)

function describeGemini(status: number, body: string): string {
  let msg = body.slice(0, 200);
  try {
    const e = (JSON.parse(body) as { error?: { message?: string; status?: string } }).error;
    if (e) msg = `${e.status ? e.status + ': ' : ''}${(e.message ?? msg).replace(/https?:\/\/\S+/g, '').trim()}`;
  } catch { /* not JSON */ }
  return `HTTP ${status}: ${msg}`;
}

// One streamed Gemini request, no retries. Throws with a readable cause (and .status) on failure.
async function callGemini(key: string, prompt: string, opts: FindClipsOptions, label: string): Promise<string> {
  const ctrl = new AbortController();
  const hard = setTimeout(() => ctrl.abort(new Error(`no answer within ${GEMINI_TIMEOUT_MS / 1000}s`)), GEMINI_TIMEOUT_MS);
  let stall: ReturnType<typeof setTimeout> | undefined;
  const alive = (ms: number, why: string) => {
    clearTimeout(stall);
    stall = setTimeout(() => ctrl.abort(new Error(`${why} for ${ms / 1000}s`)), ms);
  };
  const t0 = Date.now();
  try {
    alive(GEMINI_FIRST_TOKEN_MS, 'no first token');
    const res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3, maxOutputTokens: 16000 },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw Object.assign(new Error(describeGemini(res.status, await res.text())), { status: res.status });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', content = '', finish = '', blocked = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        let j: { error?: { code?: number; message?: string; status?: string }; promptFeedback?: { blockReason?: string };
          candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[] };
        try { j = JSON.parse(line.slice(5)); } catch { continue; }
        if (j.error) throw Object.assign(new Error(describeGemini(j.error.code ?? 200, line.slice(5))), { status: j.error.code });
        if (j.promptFeedback?.blockReason) blocked = j.promptFeedback.blockReason;
        const c = j.candidates?.[0];
        for (const p of c?.content?.parts ?? []) if (p.text && !p.thought) content += p.text;
        if (c?.finishReason) finish = c.finishReason;
        if (content) alive(GEMINI_STALL_MS, 'stalled');
      }
      opts.onProgress?.(`${label}: Gemini ${GEMINI_MODEL} ${content ? `writing answer (${content.length} chars)` : 'reading transcript'}… ${Math.round((Date.now() - t0) / 1000)}s`);
    }
    if (!content.trim()) throw new Error(blocked ? `blocked by Gemini (${blocked})` : `empty answer (finishReason ${finish || 'none'})`);
    if (finish && finish !== 'STOP') console.warn(`[reelio] Gemini finishReason ${finish}`);
    return content;
  } catch (e) {
    if (ctrl.signal.aborted && ctrl.signal.reason instanceof Error) throw ctrl.signal.reason;
    throw e;
  } finally {
    clearTimeout(hard);
    clearTimeout(stall);
  }
}

export interface Answer { clips: unknown[]; by: string; note?: string }

function chunkSegments(segs: Segment[], maxChars: number): Segment[][] {
  const chunks: Segment[][] = [];
  let cur: Segment[] = [];
  let len = 0;
  for (const s of segs) {
    const n = formatLine(s).length + 1;
    if (cur.length && len + n > maxChars) { chunks.push(cur); cur = []; len = 0; }
    cur.push(s);
    len += n;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

// Gemini first (one attempt), then OpenRouter free models (remembered one first). Reports which one answered.
class NoFit extends Error {
  note?: string;
  constructor(note?: string) { super('no free model fits this prompt'); this.note = note; }
}

// Shared by clip finding and reranking: `prompt` (with `textLen` characters of transcript-like text) goes to the
// first provider that answers with parseable JSON (answer.clips = the "clips" array of the reply).
export async function askLLM(prompt: string, textLen: number, opts: FindClipsOptions, label: string, useGemini = true): Promise<Answer> {
  const errors: string[] = [];
  let note: string | undefined;

  if (useGemini && opts.geminiKey && Date.now() >= geminiOffUntil && textLen <= GEMINI_CHARS) {
    opts.onProgress?.(`${label}: asking Gemini ${GEMINI_MODEL}…`);
    const t0 = Date.now();
    try {
      const answer = await callGemini(opts.geminiKey, prompt, opts, label);
      const clips = parseClips(answer);
      if (clips) {
        const secs = ((Date.now() - t0) / 1000).toFixed(1);
        opts.onProgress?.(`${label}: answered by Gemini ${GEMINI_MODEL} (${secs}s)`);
        console.info(`[reelio] clips answered by Gemini ${GEMINI_MODEL} in ${secs}s`);
        return { clips, by: `Gemini · ${GEMINI_MODEL}` };
      }
      throw new Error(`answer was not valid clip JSON (${answer.length} chars, starts ${JSON.stringify(answer.slice(0, 60))}, ends ${JSON.stringify(answer.slice(-40))})`);
    } catch (e) {
      const status = (e as { status?: number }).status;
      const msg = (e as Error).message;
      geminiOffUntil = status === 400 || status === 401 || status === 403 || (status === 429 && /day|daily/i.test(msg))
        ? Infinity : Date.now() + 60000;
      note = `Gemini failed: ${msg.slice(0, 160)}`;
      errors.push(`Gemini ${GEMINI_MODEL}: ${msg}`);
      console.warn(`[reelio] Gemini ${GEMINI_MODEL} failed after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${msg}`);
      opts.onProgress?.(`${label}: Gemini failed (${msg.slice(0, 80)}), falling back to OpenRouter…`);
    }
  }

  const fit = (await candidates()).filter(m => budget(m) >= textLen).slice(0, MAX_ATTEMPTS);
  if (!fit.length && textLen > FALLBACK_CHARS) throw new NoFit(note); // no free model takes this much at once
  if (!fit.length) throw new Error(`${label}: no usable free models left this session`);
  for (const m of fit) {
    opts.onProgress?.(`${label}: asking ${m.id}…`);
    for (let noThink = true; ; noThink = false) {
      try {
        const clips = parseClips(await callModel(m, prompt, opts, label, noThink));
        if (clips) {
          if (clips.length) localStorage.setItem(GOOD_KEY, m.id);
          opts.onProgress?.(`${label}: answered by ${m.id}`);
          console.info(`[reelio] clips answered by ${m.id}`);
          return { clips, by: `OpenRouter · ${m.id}`, note };
        }
        errors.push(`${m.id}: answer was not valid clip JSON`);
        console.warn(`[reelio] ${m.id} failed: answer was not valid clip JSON`);
      } catch (e) {
        const status = (e as { status?: number }).status;
        const msg = (e as Error).message;
        // Some reasoning-only models refuse reasoning:{enabled:false}; retry the same model once with low effort.
        if (status === 400 && noThink && /reason/i.test(msg)) continue;
        if (status === 403 || status === 404) deadModels.add(m.id);
        errors.push(`${m.id}: ${msg}`);
        console.warn(`[reelio] ${m.id} failed: ${msg}`);
        if (status === 401) throw new Fatal(`OpenRouter rejected the API key (${msg})`);
        if (status === 402) throw new Fatal(`OpenRouter says the account needs credits (${msg})`);
        if (status === 429 && /per-day|free-models/i.test(msg)) {
          throw new Fatal(`Daily free-model request quota is used up (${msg}). It resets at 00:00 UTC.`);
        }
      }
      break;
    }
  }
  throw new Error(`${label}: all ${errors.length} attempts failed:\n${errors.map(e => `• ${e}`).join('\n')}`);
}

// Clip-finding request for one chunk of transcript; splits it into small pieces only if no model can take it whole.
async function queryChunk(segs: Segment[], ask: number, label: string, part: string | undefined, opts: FindClipsOptions, useGemini: boolean): Promise<Answer> {
  const text = segs.map(formatLine).join('\n');
  try {
    return await askLLM(buildPrompt(text, ask, part), text.length, opts, label, useGemini);
  } catch (e) {
    if (!(e instanceof NoFit)) throw e;
    const parts = chunkSegments(segs, FALLBACK_CHARS);
    const clips: unknown[] = [];
    let by = '';
    for (let i = 0; i < parts.length; i++) {
      const a = await queryChunk(parts[i], ask, `${label} (piece ${i + 1}/${parts.length})`, `piece ${i + 1} of ${parts.length}`, opts, false);
      clips.push(...a.clips);
      by = a.by;
    }
    return { clips, by, note: e.note };
  }
}

// Snaps each raw clip to segment boundaries, enforces 15-90s, drops overlaps, sorts and caps.
function validate(raw: unknown[], segs: Segment[], maxClips: number): Clip[] {
  const first = segs[0].start;
  const last = segs[segs.length - 1].end;
  const starts = segs.map(s => s.start);
  const ends = segs.map(s => s.end);
  const nearest = (xs: number[], t: number) =>
    xs.reduce((best, x) => (Math.abs(x - t) < Math.abs(best - t) ? x : best));

  const clips: Clip[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const rs = Number(c.start);
    const re = Number(c.end);
    if (!Number.isFinite(rs) || !Number.isFinite(re) || re <= rs || rs >= last || re <= first) continue;
    const s = nearest(starts, rs);
    const window = ends.filter(x => x - s >= MIN_LEN && x - s <= MAX_LEN);
    if (!window.length) continue;
    const e = nearest(window, re);
    const score = Math.max(0, Math.min(100, Math.round(Number(c.score) || 0)));
    const tags = Array.isArray(c.hashtags)
      ? c.hashtags.map(t => String(t).trim().replace(/\s+/g, '')).filter(t => t.replace('#', '')).map(t => (t.startsWith('#') ? t : '#' + t)).slice(0, 5)
      : [];
    const caption = typeof c.caption === 'string' ? c.caption.trim() : '';
    clips.push({
      ...(caption ? { caption } : {}),
      ...(tags.length ? { hashtags: tags } : {}),
      start: s,
      end: e,
      title: String(c.title ?? ''),
      hook: String(c.hook ?? ''),
      reason: String(c.reason ?? ''),
      score,
    });
  }

  clips.sort((a, b) => b.score - a.score);
  const kept: Clip[] = [];
  for (const c of clips) {
    if (kept.length >= maxClips) break;
    const heavy = kept.some(k => {
      const overlap = Math.min(k.end, c.end) - Math.max(k.start, c.start);
      return overlap > 0.5 * Math.min(k.end - k.start, c.end - c.start);
    });
    if (!heavy) kept.push(c);
  }
  return kept;
}

// Cheap non-cryptographic hash of the transcript text (cache key part).
export function hashText(t: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}-${t.length}`;
}

export interface Stage1 { clips: Clip[]; by: string; note?: string; partial: boolean }

/** Chunk the transcript to the likely answerer's context, ask for up to `maxClips` clips per request, validate. No cache. */
export async function findCandidates(segs: Segment[], opts: FindClipsOptions, maxClips: number): Promise<Stage1> {
  // Chunk to the context window of the model most likely to answer: Gemini, else the first OpenRouter candidate.
  let chunkChars = FALLBACK_CHARS;
  if (opts.geminiKey && Date.now() >= geminiOffUntil) chunkChars = GEMINI_CHARS;
  else {
    try { const first = (await candidates())[0]; if (first) chunkChars = Math.max(FALLBACK_CHARS, budget(first)); } catch { /* model list unavailable: askLLM reports it */ }
  }
  const chunks = chunkSegments(segs, chunkChars);

  const ask = chunks.length === 1 ? maxClips : Math.min(maxClips, Math.ceil(maxClips / chunks.length) + 1);
  const raw: unknown[] = [];
  const by = new Set<string>();
  let note: string | undefined;
  let failures = 0;
  let lastErr: unknown;
  for (let i = 0; i < chunks.length; i++) {
    const multi = chunks.length > 1;
    const label = multi ? `Part ${i + 1}/${chunks.length}` : 'Analyzing transcript';
    opts.onProgress?.(`${label}…`);
    try {
      const a = await queryChunk(chunks[i], ask, label, multi ? `part ${i + 1} of ${chunks.length}` : undefined, opts, true);
      raw.push(...a.clips);
      by.add(a.by);
      note ??= a.note;
    } catch (e) {
      if (e instanceof Fatal) throw e;
      failures++;
      lastErr = e;
      opts.onProgress?.(`${label} failed, skipping`);
    }
  }
  if (failures === chunks.length) {
    throw lastErr instanceof Error ? lastErr : new Error('clip search failed');
  }
  opts.onProgress?.('Ranking clips…');
  const kept = validate(raw, segs, maxClips);
  console.info(`[reelio] first pass: asked ${ask}/chunk, model returned ${raw.length}, kept ${kept.length} after validation`);
  return { clips: kept, by: [...by].join(' + '), note, partial: failures > 0 };
}

export async function findClips(segments: Segment[], opts: FindClipsOptions = {}): Promise<Clip[]> {
  const maxClips = opts.maxClips ?? 8;
  const segs = [...segments].sort((a, b) => a.start - b.start);
  if (!segs.length) return [];

  const cacheKey = `${hashText(segs.map(formatLine).join('\n'))}|${PROMPT_VERSION}|${maxClips}`;
  if (!opts.force) {
    const hit = await getClips(cacheKey);
    if (hit?.clips.length) {
      opts.onProgress?.(`Clips loaded from cache (no request needed; originally ${hit.by})`);
      opts.onAnswered?.(`cache (originally ${hit.by})`);
      return hit.clips as Clip[];
    }
  }
  const r = await findCandidates(segs, opts, maxClips);
  opts.onProgress?.(`Found ${r.clips.length} clips`);
  opts.onAnswered?.(r.note ? `${r.by} (${r.note})` : r.by);
  if (r.clips.length && !r.partial) await putClips(cacheKey, { clips: r.clips, by: r.by });
  return r.clips;
}
