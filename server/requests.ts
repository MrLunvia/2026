/** Validation of incoming generation requests and their mapping onto each model's Higgsfield endpoint. */
import { INPUT_TYPES, aspectValue, modelById, qualityOf, resolveEndpoint, type InputType } from '../shared/models.ts';
import { ASPECT_RATIOS, DURATION, LIMITS } from '../shared/options.ts';
import { mediaCounts } from '../shared/pricing.ts';
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

function url(value: unknown, what: string): string {
  if (typeof value !== 'string' || !isAcceptableUrl(value)) fail(`${what} must be an https:// URL`);
  return value;
}

function urls(value: unknown, what: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) fail(`${what} must be a list`);
  if (value.length > LIMITS.references) fail(`${what}: at most ${LIMITS.references}`);
  return value.length > 0 ? value.map((item, i) => url(item, `${what} ${i + 1}`)) : undefined;
}

export function parseSettings(value: unknown): GenerationSettings {
  const s = record(value, 'settings');
  const model = typeof s.model === 'string' ? modelById(s.model) : undefined;
  if (!model) fail('Choose a video model');
  const quality = typeof s.quality === 'string' ? qualityOf(model, s.quality) : undefined;
  if (!quality) fail(`Choose a quality for ${model.name}`);
  const { duration, aspectRatio, generateAudio } = s;
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < DURATION.min || duration > DURATION.max) {
    fail(`duration must be a whole number of seconds from ${DURATION.min} to ${DURATION.max}`);
  }
  if (typeof aspectRatio !== 'string' || !(ASPECT_RATIOS as readonly string[]).includes(aspectRatio)) fail(`aspectRatio must be one of ${ASPECT_RATIOS.join(', ')}`);
  if (typeof generateAudio !== 'boolean') fail('generateAudio must be true or false');
  return { model: model.id, quality: quality.id, duration, aspectRatio, generateAudio };
}

/** Media links from the page; video lengths are never taken from it (the server measured them at upload). */
export function parseMedia(value: unknown, label: string): MediaInput {
  const m = record(value ?? { mode: 'text' }, `${label} media`);
  const mode = m.mode as InputType;
  if (!INPUT_TYPES.includes(mode)) fail(`${label}: unknown media mode`);
  const optional = (key: string, what: string) => (m[key] === undefined || m[key] === null ? undefined : url(m[key], `${label}: ${what}`));
  const media: MediaInput = {
    mode,
    startImageUrl: optional('startImageUrl', 'start image'),
    endImageUrl: optional('endImageUrl', 'end image'),
    referenceImageUrls: urls(m.referenceImageUrls, `${label}: reference image`),
    referenceVideoUrls: urls(m.referenceVideoUrls, `${label}: reference video`),
    referenceAudioUrls: urls(m.referenceAudioUrls, `${label}: reference audio`),
    sourceVideoUrl: optional('sourceVideoUrl', 'video'),
    soundtrackUrl: optional('soundtrackUrl', 'audio track'),
  };
  return Object.fromEntries(Object.entries(media).filter(([, v]) => v !== undefined)) as MediaInput;
}

function parsePrompt(value: unknown, index: number): PromptInput {
  const label = `Prompt ${index + 1}`;
  const p = record(value, label);
  const text = typeof p.prompt === 'string' ? p.prompt.trim() : '';
  if (text.length > LIMITS.promptChars) fail(`${label} is longer than ${LIMITS.promptChars.toLocaleString('en-US')} characters`);
  const words = countWords(text);
  if (words > LIMITS.promptWords) {
    fail(`${label} has ${words.toLocaleString('en-US')} words; the limit is ${LIMITS.promptWords.toLocaleString('en-US')}`);
  }
  const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 200) : undefined;
  return { title, prompt: text, media: parseMedia(p.media, label) };
}

export function parseCreateJobs(body: unknown): CreateJobsRequest {
  const b = record(body, 'request body');
  const settings = parseSettings(b.settings);
  if (!Array.isArray(b.prompts) || b.prompts.length === 0) fail('add at least one prompt');
  if (b.prompts.length > LIMITS.promptsPerBatch) fail(`at most ${LIMITS.promptsPerBatch} prompts per batch`);
  const prompts = b.prompts.map(parsePrompt);
  prompts.forEach((p, i) => {
    const { problems } = resolveEndpoint(settings, mediaCounts(p.media), p.prompt);
    if (problems.length > 0) fail(`Prompt ${i + 1}: ${problems[0]}`);
  });
  return { settings, prompts };
}

/** The endpoint and documented input body for one prompt; throws if these settings no longer fit it. */
export function toHiggsfieldRequest(prompt: string, settings: GenerationSettings, media: MediaInput) {
  const { spec, problems } = resolveEndpoint(settings, mediaCounts(media), prompt);
  if (!spec || problems.length > 0) throw new HttpProblem(400, problems[0] ?? 'These settings no longer fit this model');
  const quality = qualityOf(modelById(settings.model)!, settings.quality)!;
  const input: Record<string, unknown> = {};
  if (prompt) input.prompt = prompt;
  if (spec.duration) input.duration = settings.duration;
  if (spec.resolutions && quality.resolution && spec.resolutions.includes(quality.resolution)) input.resolution = quality.resolution;
  if (spec.tiers && quality.tier && spec.tiers.includes(quality.tier)) input.mode = quality.tier;
  const aspect = aspectValue(spec, settings.aspectRatio);
  if (aspect) input.aspect_ratio = aspect;
  if (spec.audio === 'generate_audio') input.generate_audio = settings.generateAudio;
  if (spec.audio === 'sound') input.sound = settings.generateAudio ? 'on' : 'off';
  if (spec.audio === 'keep_original_sound') input.keep_original_sound = settings.generateAudio ? 'yes' : 'no';
  if (spec.start && media.startImageUrl) input[spec.start.field] = media.startImageUrl;
  if (spec.end && media.endImageUrl) input[spec.end.field] = media.endImageUrl;
  if (spec.source && media.sourceVideoUrl) input[spec.source.field] = spec.source.list ? [media.sourceVideoUrl] : media.sourceVideoUrl;
  if (spec.images && media.referenceImageUrls?.length) input[spec.images.field] = media.referenceImageUrls;
  if (spec.videos && media.referenceVideoUrls?.length) input[spec.videos.field] = media.referenceVideoUrls;
  if (spec.audios && media.referenceAudioUrls?.length) input[spec.audios.field] = media.referenceAudioUrls;
  if (spec.soundtrack && media.soundtrackUrl) input[spec.soundtrack.field] = media.soundtrackUrl;
  return { endpoint: spec.path, input };
}
