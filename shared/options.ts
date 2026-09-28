/**
 * App-wide limits and display lists shared by the server and the studio.
 * What each video model accepts lives in models.ts.
 */

/** Every aspect ratio a model may offer, in display order ("auto" follows the input or the model). */
export const ASPECT_RATIOS = ['auto', '21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'] as const;

/** Outer bounds for a requested duration; each model narrows them. */
export const DURATION = { min: 1, max: 30, default: 30 } as const;

export const LIMITS = {
  promptWords: 50_000,
  promptChars: 1_000_000,
  promptsPerBatch: 500,
  imageBytes: 20 * 1024 * 1024,
  audioBytes: 30 * 1024 * 1024,
  videoBytes: 200 * 1024 * 1024,
  /** Longest uploaded video; models cap their inputs lower (the provider says so, and the video is refunded). */
  videoSeconds: 60,
  /** Most media files in one prompt's references. */
  references: 30,
} as const;

/** File types the studio offers per kind; the server checks the actual bytes. */
export const UPLOAD_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/quicktime'],
  audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mp4', 'audio/x-m4a', 'audio/aac'],
} as const;

export const UPLOAD_ACCEPT = {
  image: '.jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif',
  video: '.mp4,.mov,video/mp4,video/quicktime',
  audio: '.mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/mp4,audio/aac',
} as const;
