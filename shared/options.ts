/**
 * Seedance 2.5 on the Higgsfield API: workflow endpoints, input options and app limits,
 * shared by the server (validation) and the UI (controls).
 *
 * Endpoint and field names follow Higgsfield's per-workflow routes: a start/end frame selects
 * image-to-video, reference images select reference-to-video, a prompt alone text-to-video.
 */

export const MODEL_LABEL = 'Seedance 2.5';

export const ENDPOINTS = {
  text: 'bytedance/seedance-2.5/text-to-video',
  frames: 'bytedance/seedance-2.5/image-to-video',
  references: 'bytedance/seedance-2.5/reference-to-video',
} as const;

/** How a prompt uses images: none, a start (and optional end) frame, or reference images. */
export type MediaMode = keyof typeof ENDPOINTS;
export const MEDIA_MODES = Object.keys(ENDPOINTS) as MediaMode[];

export const DURATION = { min: 4, max: 30, default: 5 } as const;

// Through the API, Seedance 2.5 renders 480p or 720p.
export const RESOLUTIONS = ['480p', '720p'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

// image-to-video takes its framing from the start frame and has no aspect_ratio field.
export const ASPECT_RATIOS = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const LIMITS = {
  promptWords: 50_000,
  promptChars: 1_000_000,
  promptsPerBatch: 500,
  referenceImages: 9,
  uploadBytes: 20 * 1024 * 1024,
} as const;

/** Image types Higgsfield's presigned upload accepts. */
export const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
