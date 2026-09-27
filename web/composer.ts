/** Composer state: prompt cards, per-prompt images, validation, and a draft autosaved to IndexedDB. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { ASPECT_RATIOS, DURATION, LIMITS, RESOLUTIONS, UPLOAD_TYPES, type MediaMode } from '../shared/options.ts';
import { countWords, type Scene } from '../shared/text.ts';
import type { CreateJobsRequest, GenerationSettings, Job, MediaInput } from '../shared/types.ts';
import { api } from './api.ts';
import { formatBytes, formatNumber, plural, uid } from './format.ts';

export type ImageSlot = 'start' | 'end' | 'references';

export interface DraftImage {
  id: string;
  name: string;
  previewUrl: string;
  /** Public URL Higgsfield can fetch (after upload, or pasted). */
  url?: string;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
}

export interface DraftPrompt {
  id: string;
  title: string;
  text: string;
  mode: MediaMode;
  startImage?: DraftImage;
  endImage?: DraftImage;
  references: DraftImage[];
}

export interface Draft {
  settings: GenerationSettings;
  prompts: DraftPrompt[];
}

export type Notify = (message: string, tone?: 'info' | 'success' | 'error') => void;

export const DEFAULT_SETTINGS: GenerationSettings = {
  duration: DURATION.default,
  resolution: '720p',
  aspectRatio: '16:9',
  generateAudio: true,
};

const DRAFT_KEY = 'adron-video-engine/draft/v1';

export const newPrompt = (patch: Partial<DraftPrompt> = {}): DraftPrompt => ({
  id: uid(),
  title: '',
  text: '',
  mode: 'text',
  references: [],
  ...patch,
});

function fileNameOf(url: string): string {
  const last = url.split(/[?#]/)[0]?.split('/').pop() || 'image';
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

const readyImage = (url: string): DraftImage => ({ id: uid(), name: fileNameOf(url), previewUrl: url, url, status: 'ready' });

const isEmptyPrompt = (p: DraftPrompt) => !p.text.trim() && !p.startImage && !p.endImage && p.references.length === 0;

/** The images a prompt will actually send, given its mode. */
export function activeImages(p: DraftPrompt): DraftImage[] {
  if (p.mode === 'frames') return [p.startImage, p.endImage].filter((image): image is DraftImage => image !== undefined);
  if (p.mode === 'references') return p.references;
  return [];
}

export function promptProblems(p: DraftPrompt, words = countWords(p.text)): string[] {
  const problems: string[] = [];
  if (!p.text.trim()) problems.push('Write a prompt');
  if (words > LIMITS.promptWords) {
    problems.push(`${formatNumber(words)} words is over the ${formatNumber(LIMITS.promptWords)}-word limit; split it into scenes or shorten it`);
  } else if (p.text.length > LIMITS.promptChars) {
    problems.push(`Longer than ${formatNumber(LIMITS.promptChars)} characters`);
  }
  if (p.mode === 'frames' && !p.startImage) problems.push('Add a start frame');
  if (p.mode === 'references' && p.references.length === 0) problems.push('Add at least one reference image');
  const images = activeImages(p);
  if (images.some((image) => image.status === 'uploading')) problems.push('Wait for image uploads to finish');
  if (images.some((image) => image.status === 'error')) problems.push('Remove images that failed to upload');
  return problems;
}

function mediaOf(p: DraftPrompt): MediaInput {
  if (p.mode === 'frames') {
    return { mode: 'frames', startImageUrl: p.startImage?.url, ...(p.endImage?.url ? { endImageUrl: p.endImage.url } : {}) };
  }
  if (p.mode === 'references') return { mode: 'references', referenceImageUrls: p.references.flatMap((r) => (r.url ? [r.url] : [])) };
  return { mode: 'text' };
}

export function buildRequest(draft: Draft): CreateJobsRequest {
  return {
    settings: draft.settings,
    prompts: draft.prompts.map((p) => ({ title: p.title.trim() || undefined, prompt: p.text, media: mediaOf(p) })),
  };
}

// ---- persistence -------------------------------------------------------------------------

function forStorage(draft: Draft): Draft {
  // Blob previews and unfinished uploads don't survive a reload; keep only uploaded images.
  const keep = (image?: DraftImage) => (image?.status === 'ready' && image.url ? { ...image, previewUrl: image.url } : undefined);
  return {
    settings: draft.settings,
    prompts: draft.prompts.map((p) => ({
      ...p,
      startImage: keep(p.startImage),
      endImage: keep(p.endImage),
      references: p.references.flatMap((r) => keep(r) ?? []),
    })),
  };
}

function oneOf<T extends string>(options: readonly T[], value: unknown, fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function restore(value: unknown): Draft | undefined {
  const saved = value as Partial<Draft> | undefined;
  if (!saved || !Array.isArray(saved.prompts)) return undefined;
  const s: Partial<GenerationSettings> = saved.settings ?? {};
  const duration = Number.isInteger(s.duration) && s.duration! >= DURATION.min && s.duration! <= DURATION.max ? s.duration! : DURATION.default;
  const prompts = saved.prompts
    .filter((p) => p && typeof p.id === 'string' && typeof p.text === 'string')
    .map((p) => newPrompt({ ...p, references: Array.isArray(p.references) ? p.references : [] }));
  return {
    settings: {
      duration,
      resolution: oneOf(RESOLUTIONS, s.resolution, DEFAULT_SETTINGS.resolution),
      aspectRatio: oneOf(ASPECT_RATIOS, s.aspectRatio, DEFAULT_SETTINGS.aspectRatio),
      generateAudio: typeof s.generateAudio === 'boolean' ? s.generateAudio : DEFAULT_SETTINGS.generateAudio,
    },
    prompts: prompts.length > 0 ? prompts : [newPrompt()],
  };
}

// ---- image helpers -----------------------------------------------------------------------

function release(image?: DraftImage) {
  if (image?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(image.previewUrl);
}

function mapImage(p: DraftPrompt, id: string, fn: (image: DraftImage) => DraftImage): DraftPrompt {
  return {
    ...p,
    startImage: p.startImage?.id === id ? fn(p.startImage) : p.startImage,
    endImage: p.endImage?.id === id ? fn(p.endImage) : p.endImage,
    references: p.references.map((r) => (r.id === id ? fn(r) : r)),
  };
}

function withoutImage(p: DraftPrompt, id: string): DraftPrompt {
  return {
    ...p,
    startImage: p.startImage?.id === id ? undefined : p.startImage,
    endImage: p.endImage?.id === id ? undefined : p.endImage,
    references: p.references.filter((r) => r.id !== id),
  };
}

function placeImages(p: DraftPrompt, slot: ImageSlot, images: DraftImage[]): DraftPrompt {
  if (slot === 'references') return { ...p, references: [...p.references, ...images].slice(0, LIMITS.referenceImages) };
  if (slot === 'end') return { ...p, endImage: images[0] };
  // Two images dropped on the start frame: first is the start, second the end frame.
  return { ...p, startImage: images[0], endImage: images[1] ?? p.endImage };
}

// ---- hook --------------------------------------------------------------------------------

export function useComposer(notify: Notify) {
  const [draft, setDraft] = useState<Draft>();
  const [saveFailed, setSaveFailed] = useState(false);
  const draftRef = useRef<Draft | undefined>(undefined);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    idbGet(DRAFT_KEY)
      .then(restore, () => undefined)
      .then((restored) => {
        if (!cancelled) setDraft(restored ?? { settings: DEFAULT_SETTINGS, prompts: [newPrompt()] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!draft) return;
    const timer = setTimeout(() => {
      idbSet(DRAFT_KEY, forStorage(draft)).then(
        () => setSaveFailed(false),
        () => setSaveFailed(true),
      );
    }, 600);
    return () => clearTimeout(timer);
  }, [draft]);

  const update = useCallback((fn: (d: Draft) => Draft) => setDraft((d) => (d ? fn(d) : d)), []);
  const updatePrompt = useCallback(
    (id: string, fn: (p: DraftPrompt) => DraftPrompt) =>
      update((d) => ({ ...d, prompts: d.prompts.map((p) => (p.id === id ? fn(p) : p)) })),
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
    const startUpload = (promptId: string, image: DraftImage, file: File) => {
      api.upload(file).then(
        (url) => updatePrompt(promptId, (p) => mapImage(p, image.id, (i) => ({ ...i, url, status: 'ready', error: undefined }))),
        (error: Error) => {
          updatePrompt(promptId, (p) => mapImage(p, image.id, (i) => ({ ...i, status: 'error', error: error.message })));
          notify(`Upload failed for ${file.name}: ${error.message}`, 'error');
        },
      );
    };

    return {
      setSettings: (patch: Partial<GenerationSettings>) => update((d) => ({ ...d, settings: { ...d.settings, ...patch } })),

      addPrompt: () => update((d) => ({ ...d, prompts: [...d.prompts, newPrompt()] })),

      changePrompt: (id: string, patch: Partial<DraftPrompt>) => updatePrompt(id, (p) => ({ ...p, ...patch })),

      removePrompt: (id: string) => {
        const prompt = draftRef.current?.prompts.find((p) => p.id === id);
        [prompt?.startImage, prompt?.endImage, ...(prompt?.references ?? [])].forEach(release);
        update((d) => {
          const prompts = d.prompts.filter((p) => p.id !== id);
          return { ...d, prompts: prompts.length > 0 ? prompts : [newPrompt()] };
        });
      },

      duplicatePrompt: (id: string) => {
        const source = draftRef.current?.prompts.find((p) => p.id === id);
        if (!source) return;
        const copyImage = (image?: DraftImage) => (image?.status === 'ready' && image.url ? readyImage(image.url) : undefined);
        const copy = newPrompt({
          title: source.title ? `${source.title} (copy)` : '',
          text: source.text,
          mode: source.mode,
          startImage: copyImage(source.startImage),
          endImage: copyImage(source.endImage),
          references: source.references.flatMap((r) => copyImage(r) ?? []),
        });
        update((d) => {
          const index = d.prompts.findIndex((p) => p.id === id);
          return { ...d, prompts: [...d.prompts.slice(0, index + 1), copy, ...d.prompts.slice(index + 1)] };
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
            ...(references.length > 0
              ? { mode: 'references' as const, references: references.map((r) => readyImage(r.url!)) }
              : n === 0 && source.mode === 'frames'
                ? { mode: 'frames' as const, startImage: source.startImage, endImage: source.endImage }
                : {}),
          }),
        );
        update((d) => {
          const index = d.prompts.findIndex((p) => p.id === id);
          if (index < 0) return d;
          return { ...d, prompts: [...d.prompts.slice(0, index), ...made, ...d.prompts.slice(index + 1)] };
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
        insertPrompts(made);
        const words = made.reduce((sum, p) => sum + countWords(p.text), 0);
        notify(`Imported ${plural(made.length, 'file')} (${plural(words, 'word')})`, 'success');
      },

      /** Validate, show local previews immediately, and upload to Higgsfield storage in the background. */
      addFiles: (promptId: string, slot: ImageSlot, files: File[]) => {
        const prompt = draftRef.current?.prompts.find((p) => p.id === promptId);
        if (!prompt) return;
        let accepted = files.filter((file) => {
          if (!(UPLOAD_TYPES as readonly string[]).includes(file.type)) {
            notify(`${file.name}: use a JPEG, PNG, WebP or GIF image`, 'error');
            return false;
          }
          if (file.size > LIMITS.uploadBytes) {
            notify(`${file.name} is ${formatBytes(file.size)}; the limit is ${formatBytes(LIMITS.uploadBytes)}`, 'error');
            return false;
          }
          return true;
        });
        const room = slot === 'references' ? LIMITS.referenceImages - prompt.references.length : slot === 'start' ? 2 : 1;
        if (accepted.length > room) {
          notify(slot === 'references' ? `Up to ${LIMITS.referenceImages} reference images per prompt` : 'Only one image fits here', 'error');
          accepted = accepted.slice(0, Math.max(0, room));
        }
        if (accepted.length === 0) return;
        const images = accepted.map(
          (file): DraftImage => ({ id: uid(), name: file.name, previewUrl: URL.createObjectURL(file), status: 'uploading' }),
        );
        if (slot === 'start') {
          release(prompt.startImage);
          if (images.length > 1) release(prompt.endImage);
        } else if (slot === 'end') {
          release(prompt.endImage);
        }
        updatePrompt(promptId, (p) => placeImages(p, slot, images));
        images.forEach((image, i) => startUpload(promptId, image, accepted[i]!));
      },

      addImageUrl: (promptId: string, slot: ImageSlot, url: string) => {
        updatePrompt(promptId, (p) => placeImages(p, slot, [readyImage(url)]));
      },

      removeImage: (promptId: string, imageId: string) => {
        const prompt = draftRef.current?.prompts.find((p) => p.id === promptId);
        [prompt?.startImage, prompt?.endImage, ...(prompt?.references ?? [])].filter((i) => i?.id === imageId).forEach(release);
        updatePrompt(promptId, (p) => withoutImage(p, imageId));
      },

      /** Put a finished (or failed) job's prompt, images and settings back in the composer. */
      loadJob: (job: Job) => {
        const { media } = job;
        insertPrompts([
          newPrompt({
            title: job.title ?? '',
            text: job.prompt,
            mode: media.mode,
            startImage: media.startImageUrl ? readyImage(media.startImageUrl) : undefined,
            endImage: media.endImageUrl ? readyImage(media.endImageUrl) : undefined,
            references: (media.referenceImageUrls ?? []).map(readyImage),
          }),
        ]);
        update((d) => ({ ...d, settings: { ...job.settings } }));
        notify('Loaded the prompt, images and settings into the composer', 'success');
      },

      clearAll: () => {
        draftRef.current?.prompts.forEach((p) => [p.startImage, p.endImage, ...p.references].forEach(release));
        update((d) => ({ ...d, prompts: [newPrompt()] }));
      },
    };
  }, [update, updatePrompt, insertPrompts, notify]);

  return { draft, saveFailed, actions };
}

export type ComposerActions = ReturnType<typeof useComposer>['actions'];
