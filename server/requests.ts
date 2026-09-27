/** Validation of incoming generation requests and their mapping onto Higgsfield workflows. */
import {
  ASPECT_RATIOS,
  DURATION,
  ENDPOINTS,
  LIMITS,
  MEDIA_MODES,
  RESOLUTIONS,
  type AspectRatio,
  type MediaMode,
  type Resolution,
} from '../shared/options.ts';
import { countWords } from '../shared/text.ts';
import type { CreateJobsRequest, GenerationSettings, MediaInput, PromptInput } from '../shared/types.ts';
import { isAcceptableUrl } from './higgsfield.ts';

/** An error with an HTTP status whose message is safe to return to the browser. */
export class HttpProblem extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function fail(message: string): never {
  throw new HttpProblem(400, message);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${what} must be an object`);
  return value as Record<string, unknown>;
}

function imageUrl(value: unknown, what: string): string {
  if (typeof value !== 'string' || !isAcceptableUrl(value)) fail(`${what} must be an https:// URL`);
  return value;
}

export function parseSettings(value: unknown): GenerationSettings {
  const s = record(value, 'settings');
  const { duration, resolution, aspectRatio, generateAudio } = s;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < DURATION.min || duration > DURATION.max) {
    fail(`duration must be a whole number of seconds from ${DURATION.min} to ${DURATION.max}`);
  }
  if (!RESOLUTIONS.includes(resolution as Resolution)) fail(`resolution must be one of ${RESOLUTIONS.join(', ')}`);
  if (!ASPECT_RATIOS.includes(aspectRatio as AspectRatio)) fail(`aspectRatio must be one of ${ASPECT_RATIOS.join(', ')}`);
  if (typeof generateAudio !== 'boolean') fail('generateAudio must be true or false');
  return { duration, resolution: resolution as Resolution, aspectRatio: aspectRatio as AspectRatio, generateAudio };
}

function parseMedia(value: unknown, label: string): MediaInput {
  const m = record(value ?? { mode: 'text' }, `${label} media`);
  const mode = m.mode as MediaMode;
  if (!MEDIA_MODES.includes(mode)) fail(`${label}: media mode must be one of ${MEDIA_MODES.join(', ')}`);
  if (mode === 'frames') {
    return {
      mode,
      startImageUrl: imageUrl(m.startImageUrl, `${label}: start frame`),
      ...(m.endImageUrl === undefined || m.endImageUrl === null ? {} : { endImageUrl: imageUrl(m.endImageUrl, `${label}: end frame`) }),
    };
  }
  if (mode === 'references') {
    const urls = m.referenceImageUrls;
    if (!Array.isArray(urls) || urls.length === 0) fail(`${label}: add at least one reference image`);
    if (urls.length > LIMITS.referenceImages) fail(`${label}: at most ${LIMITS.referenceImages} reference images`);
    return { mode, referenceImageUrls: urls.map((url, i) => imageUrl(url, `${label}: reference image ${i + 1}`)) };
  }
  return { mode: 'text' };
}

function parsePrompt(value: unknown, index: number): PromptInput {
  const label = `Prompt ${index + 1}`;
  const p = record(value, label);
  if (typeof p.prompt !== 'string' || !p.prompt.trim()) fail(`${label} is empty`);
  if (p.prompt.length > LIMITS.promptChars) fail(`${label} is longer than ${LIMITS.promptChars.toLocaleString('en-US')} characters`);
  const words = countWords(p.prompt);
  if (words > LIMITS.promptWords) {
    fail(`${label} has ${words.toLocaleString('en-US')} words; the limit is ${LIMITS.promptWords.toLocaleString('en-US')}`);
  }
  const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 200) : undefined;
  return { title, prompt: p.prompt.trim(), media: parseMedia(p.media, label) };
}

export function parseCreateJobs(body: unknown): CreateJobsRequest {
  const b = record(body, 'request body');
  const settings = parseSettings(b.settings);
  if (!Array.isArray(b.prompts) || b.prompts.length === 0) fail('add at least one prompt');
  if (b.prompts.length > LIMITS.promptsPerBatch) fail(`at most ${LIMITS.promptsPerBatch} prompts per batch`);
  return { settings, prompts: b.prompts.map(parsePrompt) };
}

/** Pick the Seedance workflow for a prompt and build its documented input body. */
export function toHiggsfieldRequest(prompt: string, settings: GenerationSettings, media: MediaInput) {
  const common = {
    prompt,
    duration: settings.duration,
    resolution: settings.resolution,
    generate_audio: settings.generateAudio,
  };
  if (media.mode === 'frames') {
    // image-to-video frames from the start image; it has no aspect_ratio field.
    return {
      endpoint: ENDPOINTS.frames,
      input: { ...common, image_url: media.startImageUrl, ...(media.endImageUrl ? { end_image_url: media.endImageUrl } : {}) },
    };
  }
  if (media.mode === 'references') {
    return {
      endpoint: ENDPOINTS.references,
      input: { ...common, aspect_ratio: settings.aspectRatio, image_urls: media.referenceImageUrls },
    };
  }
  return { endpoint: ENDPOINTS.text, input: { ...common, aspect_ratio: settings.aspectRatio } };
}
