/** What each model can do, summed up for model cards, filters and badges. */
import { INPUT_TYPES, MODELS, type InputType, type VideoModel } from '../shared/models.ts';

export interface ModelTraits {
  /** Longest video it makes from scratch, in seconds (0 when the length always comes from an uploaded video). */
  maxSeconds: number;
  /** Highest picture quality offered, e.g. "4K" or "1080p". */
  topResolution?: string;
  sound: boolean;
  inputs: InputType[];
}

const RESOLUTIONS = ['4K', '2K', '1080p', '768p', '720p', '540p', '480p', '360p'];
const VIDEO_INPUTS: InputType[] = ['edit', 'extend', 'motion', 'swap', 'video-reference'];

const traitCache = new Map<string, ModelTraits>();

export function modelTraits(model: VideoModel): ModelTraits {
  const cached = traitCache.get(model.id);
  if (cached) return cached;
  const specs = model.qualities.flatMap((q) => Object.values(q.inputs));
  const maxSeconds = Math.max(0, ...specs.map((s) => (s.duration ? ('options' in s.duration ? Math.max(...s.duration.options) : s.duration.max) : 0)));
  const names = model.qualities.flatMap((q) => [q.label, q.resolution ?? '']).map((name) => name.toUpperCase());
  const topResolution = RESOLUTIONS.find((r) => names.some((name) => name.includes(r.toUpperCase())));
  const traits: ModelTraits = {
    maxSeconds,
    topResolution,
    sound: specs.some((s) => s.audio === 'generate_audio' || s.audio === 'sound'),
    inputs: INPUT_TYPES.filter((input) => model.qualities.some((q) => q.inputs[input])),
  };
  traitCache.set(model.id, traits);
  return traits;
}

/** Short capability labels for a model card. */
export function modelChips(model: VideoModel): string[] {
  const t = modelTraits(model);
  const chips = [t.maxSeconds > 0 ? `Up to ${t.maxSeconds}s` : 'Video to video'];
  if (t.topResolution) chips.push(t.topResolution);
  if (t.sound) chips.push('Sound');
  if (t.inputs.includes('frames')) chips.push('Image to video');
  if (t.inputs.includes('references')) chips.push('References');
  if (t.inputs.some((input) => VIDEO_INPUTS.includes(input))) chips.push('Video input');
  return chips;
}

export type ModelFilter = 'all' | 'text' | 'image' | 'references' | 'video' | 'sound' | 'long' | 'hd';

export const MODEL_FILTERS: { id: ModelFilter; label: string; test: (model: VideoModel) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'text', label: 'Text to video', test: (m) => modelTraits(m).inputs.includes('text') },
  { id: 'image', label: 'Image to video', test: (m) => modelTraits(m).inputs.includes('frames') },
  { id: 'references', label: 'References', test: (m) => modelTraits(m).inputs.includes('references') },
  { id: 'video', label: 'Edit a video', test: (m) => modelTraits(m).inputs.some((input) => VIDEO_INPUTS.includes(input)) },
  { id: 'sound', label: 'With sound', test: (m) => modelTraits(m).sound },
  { id: 'long', label: '20 s or longer', test: (m) => modelTraits(m).maxSeconds >= 20 },
  { id: 'hd', label: '1080p and up', test: (m) => ['4K', '2K', '1080p'].includes(modelTraits(m).topResolution ?? '') },
];

/** A few highlights; everything else speaks for itself. */
export const MODEL_BADGES: Partial<Record<string, 'New' | 'Popular'>> = {
  'seedance-2.5': 'Popular',
  'kling-3.0': 'Popular',
  'kling-o3': 'New',
  'wan-3.0-prime': 'New',
  'cinema-studio-4.0': 'New',
  'minimax-h3': 'New',
  'happy-horse-1.1': 'New',
  'grok-imagine-1.5': 'New',
};

const MAKER_TONES: Record<string, [string, string]> = {
  ByteDance: ['#3b82f6', '#22d3ee'],
  Kuaishou: ['#f97316', '#facc15'],
  Alibaba: ['#8b5cf6', '#ec4899'],
  Higgsfield: ['#a3e635', '#10b981'],
  MiniMax: ['#ef4444', '#f97316'],
  Lightricks: ['#14b8a6', '#3b82f6'],
  PixVerse: ['#d946ef', '#6366f1'],
  xAI: ['#e5e7eb', '#71717a'],
};

/** Background for a model's badge-like mark, by maker. */
export function makerGradient(maker: string): string {
  const [from, to] = MAKER_TONES[maker] ?? ['#52525b', '#27272a'];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/** The letter shown in a model's mark. */
export const modelInitial = (model: VideoModel) => model.name.trim().charAt(0).toUpperCase();

export const offeredModels = (disabled: readonly string[]) => MODELS.filter((model) => !disabled.includes(model.id));
