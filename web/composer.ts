/** Composer state: prompt cards, per-prompt media, validation, prices, and a draft autosaved to IndexedDB. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import {
  DEFAULT_MODEL,
  INPUT_TYPES,
  endpointFor,
  modelById,
  modelControls,
  qualityOf,
  resolveEndpoint,
  type EndpointSpec,
  type InputType,
  type MediaCounts,
  type MediaKind,
} from '../shared/models.ts';
import { ASPECT_RATIOS, DURATION, LIMITS, UPLOAD_TYPES } from '../shared/options.ts';
import { withPreset, type Preset, type PresetFamily } from '../shared/presets.ts';
import { countWords, type Scene } from '../shared/text.ts';
import type { CreateJobsRequest, GenerationSettings, Job, MediaInput } from '../shared/types.ts';
import { api } from './api.ts';
import { formatBytes, formatNumber, plural, uid } from './format.ts';

/** Where a file goes in a prompt card. */
export type Slot = 'start' | 'end' | 'source' | 'soundtrack' | 'references';

export interface DraftMedia {
  id: string;
  kind: MediaKind;
  name: string;
  previewUrl: string;
  /** Public URL Higgsfield can fetch (after upload, or a pasted image link). */
  url?: string;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
  /** Upload progress, 0 to 1. */
  progress?: number;
  /** Length the server measured (videos). */
  seconds?: number;
}

export interface DraftPrompt {
  id: string;
  title: string;
  text: string;
  mode: InputType;
  /** Start frame, or a motion-control character image. */
  start?: DraftMedia;
  end?: DraftMedia;
  /** The video to edit, extend or take motion from. */
  source?: DraftMedia;
  soundtrack?: DraftMedia;
  /** Reference images, videos and audio, in order. */
  references: DraftMedia[];
}

export interface Draft {
  settings: GenerationSettings;
  prompts: DraftPrompt[];
}

export type Notify = (message: string, tone?: 'info' | 'success' | 'error') => void;

// A prompt typed on the home page waits here while the visitor signs up or logs in.
const PENDING_PROMPT_KEY = 'adron-video-engine/pending-prompt';

export function savePendingPrompt(text: string): void {
  try {
    sessionStorage.setItem(PENDING_PROMPT_KEY, text);
  } catch {
    // Storage blocked (private mode, settings): the visitor just starts with an empty prompt.
  }
}

export function takePendingPrompt(): string | undefined {
  try {
    const text = sessionStorage.getItem(PENDING_PROMPT_KEY);
    sessionStorage.removeItem(PENDING_PROMPT_KEY);
    return text?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export const DEFAULT_SETTINGS: GenerationSettings = {
  model: DEFAULT_MODEL,
  quality: '720p',
  duration: DURATION.default,
  aspectRatio: '16:9',
  generateAudio: true,
};

export const newPrompt = (patch: Partial<DraftPrompt> = {}): DraftPrompt => ({
  id: uid(),
  title: '',
  text: '',
  mode: 'text',
  references: [],
  ...patch,
});

function fileNameOf(url: string): string {
  const last = url.split(/[?#]/)[0]?.split('/').pop() || 'file';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

const readyMedia = (url: string, kind: MediaKind = 'image', seconds?: number): DraftMedia => ({
  id: uid(),
  kind,
  name: fileNameOf(url),
  previewUrl: url,
  url,
  status: 'ready',
  ...(seconds !== undefined ? { seconds } : {}),
});

const isEmptyPrompt = (p: DraftPrompt) => !p.text.trim() && !p.start && !p.end && !p.source && !p.soundtrack && p.references.length === 0;

export const usesReferences = (spec: EndpointSpec | undefined) => !!(spec?.images || spec?.videos || spec?.audios);

/** Reference kinds an endpoint takes, with their limits. */
export function referenceLimits(spec: EndpointSpec | undefined): Partial<Record<MediaKind, { min: number; max: number }>> {
  const limits: Partial<Record<MediaKind, { min: number; max: number }>> = {};
  if (spec?.images) limits.image = spec.images;
  if (spec?.videos) limits.video = spec.videos;
  if (spec?.audios) limits.audio = spec.audios;
  return limits;
}

/** The media a prompt will actually send with its current mode. */
export function activeMedia(p: DraftPrompt, spec: EndpointSpec | undefined): DraftMedia[] {
  return [
    spec?.start ? p.start : undefined,
    spec?.end ? p.end : undefined,
    spec?.source ? p.source : undefined,
    spec?.soundtrack ? p.soundtrack : undefined,
    ...(usesReferences(spec) ? p.references : []),
  ].filter((m): m is DraftMedia => m !== undefined);
}

/** Counts for the shared checks and prices; unsupported media still counts so it can be flagged. */
export function countsOf(p: DraftPrompt, spec: EndpointSpec | undefined): MediaCounts {
  const refs = usesReferences(spec) ? p.references : [];
  const of = (kind: MediaKind) => refs.filter((r) => r.kind === kind);
  return {
    mode: p.mode,
    start: !!spec?.start && !!p.start,
    end: !!spec?.end && !!p.end,
    source: !!spec?.source && !!p.source,
    soundtrack: !!spec?.soundtrack && !!p.soundtrack,
    images: of('image').length,
    videos: of('video').length,
    audios: of('audio').length,
    sourceSeconds: spec?.source ? p.source?.seconds : undefined,
    referenceVideoSeconds: of('video').map((v) => v.seconds ?? 0),
  };
}

export function promptProblems(p: DraftPrompt, settings: GenerationSettings, words = countWords(p.text)): string[] {
  const problems: string[] = [];
  if (words > LIMITS.promptWords) {
    problems.push(`${formatNumber(words)} words is over the ${formatNumber(LIMITS.promptWords)}-word limit; split it into scenes or shorten it`);
  } else if (p.text.length > LIMITS.promptChars) {
    problems.push(`Longer than ${formatNumber(LIMITS.promptChars)} characters`);
  }
  const spec = endpointFor(settings, p.mode);
  problems.push(...resolveEndpoint(settings, countsOf(p, spec), p.text).problems);
  const media = activeMedia(p, spec);
  if (media.some((m) => m.status === 'uploading')) problems.push('Wait for uploads to finish');
  if (media.some((m) => m.status === 'error')) problems.push('Remove files that failed to upload');
  return problems;
}

function mediaOf(p: DraftPrompt, settings: GenerationSettings): MediaInput {
  const spec = endpointFor(settings, p.mode);
  const urls = (kind: MediaKind) => (usesReferences(spec) ? p.references.filter((r) => r.kind === kind).flatMap((r) => (r.url ? [r.url] : [])) : []);
  const media: MediaInput = { mode: p.mode };
  if (spec?.start && p.start?.url) media.startImageUrl = p.start.url;
  if (spec?.end && p.end?.url) media.endImageUrl = p.end.url;
  if (spec?.source && p.source?.url) media.sourceVideoUrl = p.source.url;
  if (spec?.soundtrack && p.soundtrack?.url) media.soundtrackUrl = p.soundtrack.url;
  const images = urls('image');
  const videos = urls('video');
  const audios = urls('audio');
  if (images.length > 0) media.referenceImageUrls = images;
  if (videos.length > 0) media.referenceVideoUrls = videos;
  if (audios.length > 0) media.referenceAudioUrls = audios;
  return media;
}

export function buildRequest(draft: Draft): CreateJobsRequest {
  return {
    settings: draft.settings,
    prompts: draft.prompts.map((p) => ({ title: p.title.trim() || undefined, prompt: p.text, media: mediaOf(p, draft.settings) })),
  };
}

// ---- settings --------------------------------------------------------------------------------

/** Keep settings valid for the chosen model: a known quality, a duration and ratio it offers. */
export function fitSettings(settings: GenerationSettings): GenerationSettings {
  const model = modelById(settings.model) ?? modelById(DEFAULT_MODEL)!;
  const quality = qualityOf(model, settings.quality) ? settings.quality : model.defaultQuality;
  const controls = modelControls(model, quality);
  let duration = settings.duration;
  if (controls.duration && 'options' in controls.duration) {
    const options = controls.duration.options;
    if (!options.includes(duration)) duration = options.reduce((best, d) => (Math.abs(d - settings.duration) < Math.abs(best - settings.duration) ? d : best), options[0]!);
  } else if (controls.duration) {
    duration = Math.min(controls.duration.max, Math.max(controls.duration.min, duration));
  }
  const aspectRatio =
    controls.aspectRatios.length === 0 || controls.aspectRatios.includes(settings.aspectRatio)
      ? settings.aspectRatio
      : controls.aspectRatios.includes('16:9')
        ? '16:9'
        : controls.aspectRatios[0]!;
  return { ...settings, model: model.id, quality, duration, aspectRatio };
}

/** A mode the model offers, preferring the prompt's current one. */
function fitMode(mode: InputType, settings: GenerationSettings): InputType {
  const model = modelById(settings.model);
  if (!model) return mode;
  const offered = INPUT_TYPES.filter((input) => model.qualities.some((q) => q.inputs[input]));
  return offered.includes(mode) ? mode : (offered[0] ?? 'text');
}

// ---- persistence -------------------------------------------------------------------------

function forStorage(draft: Draft): Draft {
  // Blob previews and unfinished uploads don't survive a reload; keep only uploaded files.
  const keep = (m?: DraftMedia) => (m?.status === 'ready' && m.url ? { ...m, previewUrl: m.url, progress: undefined } : undefined);
  return {
    settings: draft.settings,
    prompts: draft.prompts.map((p) => ({
      ...p,
      start: keep(p.start),
      end: keep(p.end),
      source: keep(p.source),
      soundtrack: keep(p.soundtrack),
      references: p.references.flatMap((r) => keep(r) ?? []),
    })),
  };
}

type SavedPrompt = Partial<DraftPrompt> & { startImage?: DraftMedia; endImage?: DraftMedia };

/** Accepts drafts saved by this version and by the Seedance-only version before it. */
function restore(value: unknown): Draft | undefined {
  const saved = value as { settings?: Partial<GenerationSettings> & { resolution?: string }; prompts?: SavedPrompt[] } | undefined;
  if (!saved || !Array.isArray(saved.prompts)) return undefined;
  const s = saved.settings ?? {};
  const settings = fitSettings({
    model: typeof s.model === 'string' ? s.model : DEFAULT_MODEL,
    quality: typeof s.quality === 'string' ? s.quality : typeof s.resolution === 'string' ? s.resolution : DEFAULT_SETTINGS.quality,
    duration: Number.isInteger(s.duration) && s.duration! >= DURATION.min && s.duration! <= DURATION.max ? s.duration! : DURATION.default,
    aspectRatio: (ASPECT_RATIOS as readonly string[]).includes(s.aspectRatio ?? '') ? s.aspectRatio! : DEFAULT_SETTINGS.aspectRatio,
    generateAudio: typeof s.generateAudio === 'boolean' ? s.generateAudio : DEFAULT_SETTINGS.generateAudio,
  });
  const withKind = (m: DraftMedia | undefined, kind: MediaKind) => (m && typeof m.url === 'string' ? { ...m, kind: m.kind ?? kind } : undefined);
  const prompts = saved.prompts
    .filter((p) => p && typeof p.id === 'string' && typeof p.text === 'string')
    .map((p) =>
      newPrompt({
        id: p.id,
        title: typeof p.title === 'string' ? p.title : '',
        text: p.text,
        mode: fitMode(INPUT_TYPES.includes(p.mode as InputType) ? (p.mode as InputType) : 'text', settings),
        start: withKind(p.start ?? p.startImage, 'image'),
        end: withKind(p.end ?? p.endImage, 'image'),
        source: withKind(p.source, 'video'),
        soundtrack: withKind(p.soundtrack, 'audio'),
        references: Array.isArray(p.references) ? p.references.flatMap((r) => withKind(r, 'image') ?? []) : [],
      }),
    );
  return { settings, prompts: prompts.length > 0 ? prompts : [newPrompt()] };
}

// ---- media helpers -----------------------------------------------------------------------

function release(m?: DraftMedia) {
  if (m?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(m.previewUrl);
}

const allMedia = (p: DraftPrompt) => [p.start, p.end, p.source, p.soundtrack, ...p.references].filter((m): m is DraftMedia => m !== undefined);

function mapMedia(p: DraftPrompt, id: string, fn: (m: DraftMedia) => DraftMedia): DraftPrompt {
  const one = (m?: DraftMedia) => (m?.id === id ? fn(m) : m);
  return { ...p, start: one(p.start), end: one(p.end), source: one(p.source), soundtrack: one(p.soundtrack), references: p.references.map((r) => (r.id === id ? fn(r) : r)) };
}

function withoutMedia(p: DraftPrompt, id: string): DraftPrompt {
  const one = (m?: DraftMedia) => (m?.id === id ? undefined : m);
  return { ...p, start: one(p.start), end: one(p.end), source: one(p.source), soundtrack: one(p.soundtrack), references: p.references.filter((r) => r.id !== id) };
}

function place(p: DraftPrompt, slot: Slot, items: DraftMedia[]): DraftPrompt {
  if (slot === 'references') return { ...p, references: [...p.references, ...items] };
  if (slot === 'start') return { ...p, start: items[0], end: items[1] ?? p.end };
  return { ...p, [slot]: items[0] };
}

export function kindOfFile(file: File): MediaKind | undefined {
  for (const kind of ['image', 'video', 'audio'] as const) {
    if ((UPLOAD_TYPES[kind] as readonly string[]).includes(file.type)) return kind;
  }
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (ext && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'image';
  if (ext && ['mp4', 'mov'].includes(ext)) return 'video';
  if (ext && ['mp3', 'wav', 'm4a', 'aac'].includes(ext)) return 'audio';
  return undefined;
}

const SIZE_LIMIT: Record<MediaKind, number> = { image: LIMITS.imageBytes, video: LIMITS.videoBytes, audio: LIMITS.audioBytes };
const KIND_WORD: Record<MediaKind, string> = { image: 'image', video: 'video', audio: 'audio file' };

/** Which kinds a slot takes, and how many more fit. */
function slotRoom(p: DraftPrompt, slot: Slot, spec: EndpointSpec | undefined): Partial<Record<MediaKind, number>> {
  if (slot === 'start') return { image: spec?.end ? 2 : 1 };
  if (slot === 'end') return { image: 1 };
  if (slot === 'source') return { video: 1 };
  if (slot === 'soundtrack') return { audio: 1 };
  const room: Partial<Record<MediaKind, number>> = {};
  for (const [kind, limits] of Object.entries(referenceLimits(spec)) as [MediaKind, { max: number }][]) {
    room[kind] = Math.max(0, limits.max - p.references.filter((r) => r.kind === kind).length);
  }
  return room;
}

// ---- hook --------------------------------------------------------------------------------

/** `draftKey` keeps each account's draft separate on a shared browser. */
export function useComposer(notify: Notify, draftKey: string) {
  const [draft, setDraft] = useState<Draft>();
  const [saveFailed, setSaveFailed] = useState(false);
  const draftRef = useRef<Draft | undefined>(undefined);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    idbGet(draftKey)
      .then(restore, () => undefined)
      .then((restored) => {
        if (!cancelled) setDraft(restored ?? { settings: DEFAULT_SETTINGS, prompts: [newPrompt()] });
      });
    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => {
      idbSet(draftKey, forStorage(draft)).then(
        () => setSaveFailed(false),
        () => setSaveFailed(true),
      );
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, draftKey]);

  const update = useCallback((fn: (d: Draft) => Draft) => setDraft((d) => (d ? fn(d) : d)), []);
  const updatePrompt = useCallback(
    (id: string, fn: (p: DraftPrompt) => DraftPrompt) => update((d) => ({ ...d, prompts: d.prompts.map((p) => (p.id === id ? fn(p) : p)) })),
    [update],
  );

  /** Put new prompts in place of a lone empty card, otherwise after the existing ones. */
  const insertPrompts = useCallback(
    (prompts: DraftPrompt[]) =>
      update((d) => ({
        ...d,
        prompts: d.prompts.length === 1 && isEmptyPrompt(d.prompts[0]!) ? prompts : [...d.prompts, ...prompts],
      })),
    [update],
  );

  const actions = useMemo(() => {
    const startUpload = (promptId: string, media: DraftMedia, file: File) => {
      let last = 0;
      api
        .upload(file, (fraction) => {
          // Re-render at most every 5%.
          if (fraction - last < 0.05 && fraction < 1) return;
          last = fraction;
          updatePrompt(promptId, (p) => mapMedia(p, media.id, (m) => ({ ...m, progress: fraction })));
        })
        .then(
          (result) => {
            if (result.kind !== media.kind) throw new Error(`that file is ${result.kind === 'audio' ? 'audio' : `a ${result.kind}`}, not ${media.kind === 'audio' ? 'audio' : `a ${media.kind}`}`);
            updatePrompt(promptId, (p) =>
              mapMedia(p, media.id, (m) => ({ ...m, url: result.url, seconds: result.seconds, status: 'ready', progress: undefined, error: undefined })),
            );
          },
        )
        .catch((error: Error) => {
          updatePrompt(promptId, (p) => mapMedia(p, media.id, (m) => ({ ...m, status: 'error', progress: undefined, error: error.message })));
          notify(`Upload failed for ${file.name}: ${error.message}`, 'error');
        });
    };

    return {
      /** Change output settings; a new model keeps each prompt on a mode it offers. */
      setSettings: (patch: Partial<GenerationSettings>) =>
        update((d) => {
          const settings = fitSettings({ ...d.settings, ...patch });
          const prompts = settings.model === d.settings.model ? d.prompts : d.prompts.map((p) => ({ ...p, mode: fitMode(p.mode, settings) }));
          return { ...d, settings, prompts };
        }),

      addPrompt: () =>
        update((d) => ({ ...d, prompts: [...d.prompts, newPrompt({ mode: fitMode(d.prompts.at(-1)?.mode ?? 'text', d.settings) })] })),

      changePrompt: (id: string, patch: Partial<DraftPrompt>) => updatePrompt(id, (p) => ({ ...p, ...patch })),

      removePrompt: (id: string) => {
        const prompt = draftRef.current?.prompts.find((p) => p.id === id);
        if (prompt) allMedia(prompt).forEach(release);
        update((d) => {
          const prompts = d.prompts.filter((p) => p.id !== id);
          return { ...d, prompts: prompts.length > 0 ? prompts : [newPrompt({ mode: fitMode('text', d.settings) })] };
        });
      },

      duplicatePrompt: (id: string) => {
        const source = draftRef.current?.prompts.find((p) => p.id === id);
        if (!source) return;
        const copy = (m?: DraftMedia) => (m?.status === 'ready' && m.url ? readyMedia(m.url, m.kind, m.seconds) : undefined);
        const made = newPrompt({
          title: source.title ? `${source.title} (copy)` : '',
          text: source.text,
          mode: source.mode,
          start: copy(source.start),
          end: copy(source.end),
          source: copy(source.source),
          soundtrack: copy(source.soundtrack),
          references: source.references.flatMap((r) => copy(r) ?? []),
        });
        update((d) => {
          const index = d.prompts.findIndex((p) => p.id === id);
          return { ...d, prompts: [...d.prompts.slice(0, index + 1), made, ...d.prompts.slice(index + 1)] };
        });
      },

      /** Replace one prompt with scene prompts; references can carry over for consistency. */
      replaceWithScenes: (id: string, scenes: Scene[], options: { prefix: string; copyReferences: boolean }) => {
        const source = draftRef.current?.prompts.find((p) => p.id === id);
        if (!source || scenes.length === 0) return;
        const prefix = options.prefix.trim();
        const references = source.mode === 'references' && options.copyReferences ? source.references.filter((r) => r.url) : [];
        const made = scenes.map((scene, n) =>
          newPrompt({
            title: scene.title ?? `Scene ${n + 1}`,
            text: prefix ? `${prefix}\n\n${scene.text}` : scene.text,
            // Scene 1 keeps the original's media; the others share its references, or are text only.
            mode: references.length > 0 ? 'references' : n === 0 ? source.mode : 'text',
            ...(references.length > 0 ? { references: references.map((r) => readyMedia(r.url!, r.kind, r.seconds)) } : {}),
            ...(n === 0 ? { start: source.start, end: source.end, source: source.source, soundtrack: source.soundtrack } : {}),
          }),
        );
        update((d) => {
          const index = d.prompts.findIndex((p) => p.id === id);
          if (index < 0) return d;
          const fitted = made.map((p) => ({ ...p, mode: fitMode(p.mode, d.settings) }));
          return { ...d, prompts: [...d.prompts.slice(0, index), ...fitted, ...d.prompts.slice(index + 1)] };
        });
        notify(`Split into ${plural(made.length, 'scene prompt')}`, 'success');
      },

      /** Each text file becomes a prompt (the word limit is checked like typed text). */
      importTextFiles: async (files: File[]) => {
        const made: DraftPrompt[] = [];
        for (const file of files) {
          const text = await file.text();
          if (text.trim()) made.push(newPrompt({ title: file.name.replace(/\.[^.]+$/, ''), text }));
        }
        if (made.length === 0) {
          notify('Those files were empty', 'error');
          return;
        }
        const settings = draftRef.current?.settings ?? DEFAULT_SETTINGS;
        insertPrompts(made.map((p) => ({ ...p, mode: fitMode('text', settings) })));
        const words = made.reduce((sum, p) => sum + countWords(p.text), 0);
        notify(`Imported ${plural(made.length, 'file')} (${plural(words, 'word')})`, 'success');
      },

      /** Check files against the slot, show local previews at once, and upload in the background. */
      addFiles: (promptId: string, slot: Slot, files: File[], mode?: InputType) => {
        const d = draftRef.current;
        const prompt = d?.prompts.find((p) => p.id === promptId);
        if (!d || !prompt) return;
        // `mode` covers a mode change made in the same event, before state catches up.
        const spec = endpointFor(d.settings, mode ?? prompt.mode);
        const room = slotRoom(prompt, slot, spec);
        const used: Partial<Record<MediaKind, number>> = {};
        const accepted: { file: File; kind: MediaKind }[] = [];
        for (const file of files) {
          const kind = kindOfFile(file);
          const allowed = Object.keys(room) as MediaKind[];
          if (!kind || !allowed.includes(kind)) {
            notify(`${file.name}: add ${allowed.map((k) => (k === 'image' ? 'a JPEG, PNG, WebP or GIF image' : k === 'video' ? 'an MP4 or MOV video' : 'an MP3, WAV, M4A or AAC file')).join(' or ')} here`, 'error');
            continue;
          }
          if (file.size > SIZE_LIMIT[kind]) {
            notify(`${file.name} is ${formatBytes(file.size)}; ${KIND_WORD[kind]}s can be up to ${formatBytes(SIZE_LIMIT[kind])}`, 'error');
            continue;
          }
          if ((used[kind] ?? 0) >= (room[kind] ?? 0)) {
            notify(slot === 'references' ? `No room for more ${KIND_WORD[kind]}s in this prompt` : 'Only one file fits here', 'error');
            continue;
          }
          used[kind] = (used[kind] ?? 0) + 1;
          accepted.push({ file, kind });
        }
        if (accepted.length === 0) return;
        const items = accepted.map(
          ({ file, kind }): DraftMedia => ({ id: uid(), kind, name: file.name, previewUrl: URL.createObjectURL(file), status: 'uploading', progress: 0 }),
        );
        if (slot === 'start') {
          release(prompt.start);
          if (items.length > 1) release(prompt.end);
        } else if (slot !== 'references') {
          release(prompt[slot]);
        }
        updatePrompt(promptId, (p) => place(p, slot, items));
        items.forEach((item, i) => startUpload(promptId, item, accepted[i]!.file));
      },

      /** Public image links work directly; videos and audio are uploaded so their length is known. */
      addImageUrl: (promptId: string, slot: 'start' | 'end' | 'references', url: string) => {
        updatePrompt(promptId, (p) => place(p, slot, [readyMedia(url, 'image')]));
      },

      removeMedia: (promptId: string, mediaId: string) => {
        const prompt = draftRef.current?.prompts.find((p) => p.id === promptId);
        if (prompt) allMedia(prompt).filter((m) => m.id === mediaId).forEach(release);
        updatePrompt(promptId, (p) => withoutMedia(p, mediaId));
      },

      /** Put a finished (or failed) job's prompt, media and settings back in the composer. */
      loadJob: (job: Job) => {
        const { media } = job;
        const videoSeconds = media.referenceVideoSeconds ?? [];
        insertPrompts([
          newPrompt({
            title: job.title ?? '',
            text: job.prompt,
            mode: media.mode,
            start: media.startImageUrl ? readyMedia(media.startImageUrl) : undefined,
            end: media.endImageUrl ? readyMedia(media.endImageUrl) : undefined,
            source: media.sourceVideoUrl ? readyMedia(media.sourceVideoUrl, 'video', media.sourceVideoSeconds) : undefined,
            soundtrack: media.soundtrackUrl ? readyMedia(media.soundtrackUrl, 'audio') : undefined,
            references: [
              ...(media.referenceImageUrls ?? []).map((url) => readyMedia(url)),
              ...(media.referenceVideoUrls ?? []).map((url, i) => readyMedia(url, 'video', videoSeconds[i])),
              ...(media.referenceAudioUrls ?? []).map((url) => readyMedia(url, 'audio')),
            ],
          }),
        ]);
        update((d) => ({ ...d, settings: fitSettings({ ...job.settings }) }));
        notify('Loaded the prompt, media and settings into the composer', 'success');
      },

      /** Text from elsewhere (the home page, an example): fills a lone empty prompt, else becomes a new one. */
      addPromptText: (text: string, title = '') => {
        const settings = draftRef.current?.settings ?? DEFAULT_SETTINGS;
        insertPrompts([newPrompt({ title, text, mode: fitMode('text', settings) })]);
      },

      /** Write a camera or style preset's sentence into one prompt, or every prompt when `promptId` is undefined. */
      setPreset: (promptId: string | undefined, family: PresetFamily, preset: Preset | undefined) =>
        update((d) => ({
          ...d,
          prompts: d.prompts.map((p) => (promptId === undefined || p.id === promptId ? { ...p, text: withPreset(p.text, family, preset) } : p)),
        })),

      clearAll: () => {
        draftRef.current?.prompts.forEach((p) => allMedia(p).forEach(release));
        update((d) => ({ ...d, prompts: [newPrompt({ mode: fitMode('text', d.settings) })] }));
      },
    };
  }, [update, updatePrompt, insertPrompts, notify]);

  return { draft, saveFailed, actions };
}

export type ComposerActions = ReturnType<typeof useComposer>['actions'];
