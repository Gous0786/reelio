import type { Clip, Dim, DimScore, FindClipsOptions, Loud, Segment } from './types'
import { askLLM, findCandidates, formatLine, hashText, PROMPT_VERSION } from './llm'
import { getClips, putClips } from './cache'
import { baseline, loudWindows, measure, refineBounds, type Facts, type Measured } from './signals'

// Two-stage clip ranking. Stage 1 (llm.ts) proposes ~18 candidates; loudness peaks add candidate windows; boundaries are
// refined; stage 2 is ONE extra request scoring every candidate on the rubric. Totals are computed here, never by the model.

export const DIMS: Dim[] = ['arc', 'hook', 'context', 'reaction', 'novelty', 'pacing', 'clarity', 'discussion']
export const LABELS: Record<Dim, string> = {
  arc: 'Event arc', hook: 'Hook', context: 'Standalone', reaction: 'Reaction', novelty: 'Novelty',
  pacing: 'Pacing', clarity: 'A/V clarity', discussion: 'Discussion',
}
/** Rubric weights (sum 100). The only place they live. */
export const WEIGHTS: Record<Dim, number> = { arc: 20, hook: 15, context: 15, reaction: 10, novelty: 10, pacing: 10, clarity: 10, discussion: 10 }
/** Share of the final dimension score taken from the measured signal (rest = model). Dimensions not listed are model-only. */
export const MEASURED_SHARE: Partial<Record<Dim, number>> = { hook: 0.4, reaction: 0.4, pacing: 0.5, clarity: 0.5 }
/** Disqualifying flaws are gates, not weights. */
export const GATES = { arcMin: 4, arcCap: 50, overlap: 0.5 }
/** Hook for a measured VISUAL clarity score (0-10) for [start, end]; not implemented yet. When set it is averaged into
 *  the measured part of 'clarity'. */
export const signalHooks: { visualClarity?: (start: number, end: number) => number | undefined } = {}

const RANK_VERSION = 'r1';
const CANDIDATES = 18;
const r1 = (x: number) => Math.round(x * 10) / 10;
const dur = (c: { start: number; end: number }) => c.end - c.start;
const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.min(a.end, b.end) - Math.max(a.start, b.start) > GATES.overlap * Math.min(dur(a), dur(b));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

interface Work { clip: Clip; peak: boolean; facts: Facts; measured: Measured; stage1: number }

function excerpt(segs: Segment[], s: number, e: number): string {
  const t = segs.filter(g => g.end > s && g.start < e).map(g => g.text.replace(/\s+/g, ' ').trim()).join(' ');
  if (!t) return '(no speech)';
  return t.length > 1400 ? `${t.slice(0, 900)} […] ${t.slice(-400)}` : t;
}

function buildRerankPrompt(work: Work[], segs: Segment[]): string {
  const blocks = work.map((w, i) => {
    const f = w.facts;
    return [
      `### id=${i} | ${w.clip.start.toFixed(1)}-${w.clip.end.toFixed(1)}s (${f.dur.toFixed(0)} s)${w.peak ? ' | needs_meta' : ''}`,
      `facts: speech in ${(f.speechCoverage * 100).toFixed(0)}% of seconds, ${f.wordsPerSec.toFixed(1)} words/s, loudest seconds ${f.loudVsBaseline.toFixed(1)}x the stream's typical level, ` +
        `first 3 s: speech ${(f.hookSpeech * 100).toFixed(0)}% / level ${f.hookLevel.toFixed(1)}x typical, dead air ${(f.deadAir * 100).toFixed(0)}%, clipping ${f.clippedPct.toFixed(1)}%`,
      `excerpt: ${excerpt(segs, w.clip.start, w.clip.end)}`,
    ].join('\n');
  });
  return [
    'You are scoring candidate clips cut from a long stream or gameplay recording, to decide which are worth posting as short vertical videos.',
    'Each candidate has an id, a time range, a transcript excerpt (it may be sparse or empty: not every good moment has speech) and measured audio facts.',
    'Score EVERY candidate on EVERY dimension from 0 (bad) to 10 (excellent), as integers, with 3-8 words of evidence taken from the excerpt or facts:',
    '- arc: does the clip contain the necessary setup AND a satisfying payoff or reaction?',
    '- hook: is there a reason to keep watching in the opening seconds?',
    '- context: can a viewer follow it without having seen the rest of the stream?',
    '- reaction: is the streamer\'s response genuine and legible, rather than just loud?',
    '- novelty: is it a concrete, memorable event rather than routine gameplay?',
    '- pacing: could dead air and unnecessary lead-in be removed without harming the arc? (10 = already tight)',
    '- clarity: can viewers hear (or see) what makes the moment interesting? You only get audio facts and text, so judge audio.',
    '- discussion: does it invite a reaction, comparison, or grounded discussion?',
    'Judge only from the material given. Be discriminating: use the full range, and most candidates should score 7 or below on most dimensions.',
    'For candidates marked needs_meta also give "title" (max 8 words), "opening_line" (the first line spoken or the key moment in a few words), "caption" (under 150 characters) and "hashtags" (3-5, each starting with #).',
    '',
    ...blocks,
    '',
    'Reply with strict JSON only, no prose and no code fences, one entry per candidate:',
    '{"clips":[{"id":0,"arc":[0,""],"hook":[0,""],"context":[0,""],"reaction":[0,""],"novelty":[0,""],"pacing":[0,""],"clarity":[0,""],"discussion":[0,""]}]}',
  ].join('\n');
}

const num = (v: unknown): number | undefined => {
  const x = Array.isArray(v) ? v[0] : v && typeof v === 'object' ? (v as { score?: unknown }).score : v;
  const n = Number(x);
  return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : undefined;
};
const evidence = (v: unknown): string =>
  Array.isArray(v) ? String(v[1] ?? '') : v && typeof v === 'object' ? String((v as { evidence?: unknown }).evidence ?? '') : '';

async function rerank(work: Work[], segs: Segment[], maxClips: number, opts: FindClipsOptions): Promise<{ clips: Clip[]; by: string }> {
  const prompt = buildRerankPrompt(work, segs);
  opts.onProgress?.(`Reranking ${work.length} candidates…`);
  const ans = await askLLM(prompt, prompt.length, opts, 'Reranking');
  const items = new Map<number, Record<string, unknown>>();
  for (const it of ans.clips) if (it && typeof it === 'object' && Number.isInteger(Number((it as { id?: unknown }).id))) items.set(Number((it as { id: unknown }).id), it as Record<string, unknown>);
  if (items.size < Math.ceil(work.length / 2)) throw new Error(`rerank scored only ${items.size} of ${work.length} candidates`);

  const scored: Clip[] = [];
  work.forEach((w, i) => {
    const it = items.get(i);
    if (!it) return;
    const dims = {} as Record<Dim, DimScore>;
    for (const d of DIMS) {
      const model = num(it[d]);
      let measured: number | undefined = (w.measured as Partial<Record<Dim, number>>)[d];
      if (d === 'clarity' && measured !== undefined) {
        const vis = signalHooks.visualClarity?.(w.clip.start, w.clip.end);
        if (vis !== undefined) measured = (measured + vis) / 2;
      }
      const share = MEASURED_SHARE[d] ?? 0;
      const score = measured !== undefined && model !== undefined ? (1 - share) * model + share * measured : (model ?? measured ?? 5);
      dims[d] = { score: r1(score), model: model === undefined ? undefined : r1(model), measured: measured === undefined ? undefined : r1(measured), evidence: evidence(it[d]) };
    }
    let total = DIMS.reduce((t, d) => t + (WEIGHTS[d] * dims[d].score) / 10, 0);
    const capped = dims.arc.score < GATES.arcMin && total > GATES.arcCap;
    if (capped) total = GATES.arcCap;
    const c: Clip = { ...w.clip, score: Math.round(total), rank: { total: r1(total), dims, capped: capped || undefined, stage1: w.stage1, peak: w.peak || undefined } };
    if (w.peak) { // candidates found from loudness peaks have no first-pass text: take it from this reply
      const tags = Array.isArray(it.hashtags) ? it.hashtags.map(t => String(t).trim().replace(/\s+/g, '')).filter(t => t.replace('#', '')).map(t => (t.startsWith('#') ? t : `#${t}`)).slice(0, 5) : [];
      c.title = typeof it.title === 'string' && it.title ? it.title : `Loud moment at ${mmss(c.start)}`;
      c.hook = typeof it.opening_line === 'string' ? it.opening_line : '';
      c.reason = dims.arc.evidence || 'Found from a loudness peak';
      if (typeof it.caption === 'string' && it.caption.trim()) c.caption = it.caption.trim();
      if (tags.length) c.hashtags = tags;
    }
    scored.push(c);
  });
  scored.sort((a, b) => b.rank!.total - a.rank!.total);
  console.info('[reelio] rerank scores', JSON.stringify(scored.map(c => [mmss(c.start), mmss(c.end), c.rank!.total, c.rank!.stage1, c.rank!.peak ? 'peak' : '', c.title])));
  const kept: Clip[] = []; // near-duplicates keep only the best-scoring one
  for (const c of scored) if (kept.length < maxClips && !kept.some(k => overlaps(k, c))) kept.push(c);
  return { clips: kept, by: ans.by };
}

/** Stage 1 candidates + loudness-peak windows -> refined boundaries -> measured signals -> one rerank request. */
export async function findRankedClips(segments: Segment[], loud: Loud, opts: FindClipsOptions = {}): Promise<Clip[]> {
  const maxClips = opts.maxClips ?? 8;
  const segs = [...segments].sort((a, b) => a.start - b.start);
  if (!segs.length) return [];
  const h = hashText(segs.map(formatLine).join('\n'));
  const finalKey = `${h}|${PROMPT_VERSION}|${RANK_VERSION}|${maxClips}`;
  const candKey = `${h}|${PROMPT_VERSION}|cand${CANDIDATES}`;

  if (!opts.force) {
    const hit = await getClips(finalKey);
    if (hit?.clips.length) {
      opts.onProgress?.(`Clips loaded from cache (no request needed; originally ${hit.by})`);
      opts.onAnswered?.(`cache (originally ${hit.by})`);
      return hit.clips as Clip[];
    }
  }

  // Stage 1
  let cands: Clip[];
  let by1: string;
  const ch = opts.force ? undefined : await getClips(candKey);
  if (ch?.clips.length) { cands = ch.clips as Clip[]; by1 = `${ch.by} (first pass cached)`; }
  else {
    const r = await findCandidates(segs, opts, CANDIDATES);
    cands = r.clips;
    by1 = r.note ? `${r.by} (${r.note})` : r.by;
    if (cands.length && !r.partial) await putClips(candKey, { clips: cands, by: r.by });
  }
  if (!cands.length) { opts.onAnswered?.(by1); return []; }
  const firstPass = [...cands].sort((a, b) => b.score - a.score).slice(0, maxClips);

  try {
    // Candidates: first-pass clips + loud windows, boundaries refined, near-duplicates dropped, signals measured.
    const base = baseline(loud, segs);
    const work: Work[] = [];
    const add = (c: Clip, peak: boolean) => {
      const [s, e] = refineBounds(c.start, c.end, segs, loud, base);
      if (e - s < 10 || work.some(w => overlaps(w.clip, { start: s, end: e }))) return;
      const m = measure(s, e, segs, loud, base);
      work.push({ clip: { ...c, start: s, end: e }, peak, stage1: c.score, facts: m.facts, measured: m.scores });
    };
    for (const c of [...cands].sort((a, b) => b.score - a.score)) add(c, false);
    for (const [a, b] of loudWindows(loud, base)) add({ start: a, end: b, title: '', hook: '', reason: '', score: 0 }, true);

    const out = await rerank(work, segs, maxClips, opts);
    opts.onAnswered?.(`${by1}; rerank: ${out.by}`);
    if (out.clips.length) await putClips(finalKey, { clips: out.clips, by: `${by1}; rerank: ${out.by}` });
    return out.clips;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200);
    console.warn(`[reelio] rerank failed: ${msg}`);
    opts.onAnswered?.(`${by1}; rerank unavailable (${msg}), showing first-pass scores`);
    return firstPass;
  }
}
