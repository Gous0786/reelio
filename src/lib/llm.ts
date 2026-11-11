import type { Clip, FindClipsOptions, Segment } from './types';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PROXY_URL = '/api/chat';
const CHUNK_CHARS = 45000;
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

interface ModelInfo { id: string; json: boolean }
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
          .map(m => ({ id: m.id, json: !!m.supported_parameters?.includes('response_format') }))
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

const formatLine = (s: Segment) =>
  `[${Math.round(s.start)}-${Math.round(s.end)}] ${s.text.replace(/\s+/g, ' ').trim()}`;

function buildPrompt(text: string, n: number, part?: string): string {
  return [
    `Transcript${part ? ` (${part} of a longer video)` : ''}, one line per segment as [start-end] text, times in seconds:`,
    text,
    '',
    `Pick up to ${n} of the best short-form clips (YouTube Shorts / Reels) from this transcript.`,
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
function parseClips(text: string): unknown[] | null {
  const body = text.replace(/<think>[\s\S]*?<\/think>/g, '');
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(body.slice(start, end + 1)) as { clips?: unknown };
    if (Array.isArray(obj)) return obj;
    return Array.isArray(obj.clips) ? obj.clips : null;
  } catch {
    return null;
  }
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

async function queryChunk(prompt: string, opts: FindClipsOptions, label: string): Promise<unknown[]> {
  const good = localStorage.getItem(GOOD_KEY);
  const models = (await loadModels())
    .filter(m => !deadModels.has(m.id))
    .sort((a, b) => Number(b.id === good) - Number(a.id === good)) // stable: the rest keep their order
    .slice(0, MAX_ATTEMPTS);
  if (!models.length) throw new Error('no usable free models left this session');
  const errors: string[] = [];
  for (const m of models) {
    opts.onProgress?.(`${label}: asking ${m.id}…`);
    for (let noThink = true; ; noThink = false) {
      try {
        const clips = parseClips(await callModel(m, prompt, opts, label, noThink));
        if (clips) {
          if (clips.length) localStorage.setItem(GOOD_KEY, m.id);
          opts.onProgress?.(`${label}: answered by ${m.id}`);
          console.info(`[reelio] clips answered by ${m.id}`);
          return clips;
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
  throw new Error(`${label}: all ${models.length} models failed:\n${errors.map(e => `• ${e}`).join('\n')}`);
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

export async function findClips(segments: Segment[], opts: FindClipsOptions = {}): Promise<Clip[]> {
  const maxClips = opts.maxClips ?? 8;
  const segs = [...segments].sort((a, b) => a.start - b.start);
  if (!segs.length) return [];

  const chunks: Segment[][] = [];
  let cur: Segment[] = [];
  let len = 0;
  for (const s of segs) {
    const line = formatLine(s);
    if (cur.length && len + line.length > CHUNK_CHARS) {
      chunks.push(cur);
      cur = [];
      len = 0;
    }
    cur.push(s);
    len += line.length + 1;
  }
  if (cur.length) chunks.push(cur);

  const ask = chunks.length === 1 ? maxClips : Math.min(maxClips, Math.ceil(maxClips / chunks.length) + 1);
  const raw: unknown[] = [];
  let failures = 0;
  let lastErr: unknown;
  for (let i = 0; i < chunks.length; i++) {
    const multi = chunks.length > 1;
    const label = multi ? `Part ${i + 1}/${chunks.length}` : 'Analyzing transcript';
    opts.onProgress?.(`${label}…`);
    const text = chunks[i].map(formatLine).join('\n');
    const prompt = buildPrompt(text, ask, multi ? `part ${i + 1} of ${chunks.length}` : undefined);
    try {
      raw.push(...(await queryChunk(prompt, opts, label)));
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
  const clips = validate(raw, segs, maxClips);
  opts.onProgress?.(`Found ${clips.length} clips`);
  return clips;
}
