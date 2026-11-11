export interface Segment { start: number; end: number; text: string }
export interface Clip { start: number; end: number; title: string; hook: string; reason: string; score: number; caption?: string; hashtags?: string[] }
export interface FindClipsOptions { apiKey?: string; maxClips?: number; onProgress?: (msg: string) => void }
