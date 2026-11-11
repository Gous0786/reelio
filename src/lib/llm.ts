import type { Clip, FindClipsOptions, Segment } from './types';

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const PROXY_URL = '/api/chat';
const CHUNK_CHARS = 45000;
const MAX_ATTEMPTS = 4;
const MIN_LEN = 15;
const MAX_LEN = 90;
// Substrings of model ids, strongest general-purpose models first.
const PREFERENCE = [
  'llama-3.3-70b', 'qwen3', 'gemma-3-27b', 'mistral-small', 'nemotron',
  'llama-3.1-405b', 'deepseek', 'gemma', 'qwen', 'llama', 'mistral',
];

let modelsCache: Promise<string[]> | null = null;

function loadModels(): Promise<string[]> {
  if (!modelsCache) {
    modelsCache = fetch(MODELS_URL)
      .then(r => {
        if (!r.ok) throw new Error(`model list HTTP ${r.status}`);
        return r.json();
      })
      .then((j: { data?: { id: string; context_length?: number }[] }) => {
        const rank = (id: string) => {
          const i = PREFERENCE.findIndex(p => id.includes(p));
          return i < 0 ? PREFERENCE.length : i;
        };
        const ids = (j.data ?? [])
          .filter(m => m.id.endsWith(':free') && (m.context_length ?? 0) >= 32000)
          .map(m => m.id)
          .sort((a, b) => rank(a) - rank(b));
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
  `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text.replace(/\s+/g, ' ').trim()}`;

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
    '{"clips":[{"start":0.0,"end":0.0,"title":"","hook":"","reason":"","score":0}]}',
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
    return Array.isArray(obj.clips) ? obj.clips : null;
  } catch {
    return null;
  }
}

async function queryChunk(prompt: string, opts: FindClipsOptions, label: string): Promise<unknown[]> {
  const models = await loadModels();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  let lastErr = 'no attempt made';
  for (const model of models.slice(0, MAX_ATTEMPTS)) {
    opts.onProgress?.(`${label}: asking ${model}…`);
    try {
      const res = await fetch(opts.apiKey ? CHAT_URL : PROXY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });
      if (!res.ok) {
        lastErr = `${model} HTTP ${res.status}`;
        continue;
      }
      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const clips = parseClips(data.choices?.[0]?.message?.content ?? '');
      if (clips) return clips;
      lastErr = `${model} returned unparseable output`;
    } catch (e) {
      lastErr = `${model}: ${(e as Error).message}`;
    }
  }
  throw new Error(`${label} failed after ${MAX_ATTEMPTS} attempts (${lastErr})`);
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
    clips.push({
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
