import type { AspectRatio, MediaMode, Resolution } from './options.ts';

export interface GenerationSettings {
  duration: number;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  generateAudio: boolean;
}

export interface MediaInput {
  mode: MediaMode;
  startImageUrl?: string;
  endImageUrl?: string;
  referenceImageUrls?: string[];
}

export interface PromptInput {
  title?: string;
  prompt: string;
  media: MediaInput;
}

export interface CreateJobsRequest {
  settings: GenerationSettings;
  prompts: PromptInput[];
}

/**
 * `pending` and `submitting` are local (nothing billed yet); `queued` through `canceled` are
 * Higgsfield's request states; `error` means the request never started or its outcome is unknown.
 */
export type JobStatus =
  | 'pending'
  | 'submitting'
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'nsfw'
  | 'canceled'
  | 'error';

export const ACTIVE_STATUSES: readonly JobStatus[] = ['pending', 'submitting', 'queued', 'in_progress'];

export interface JobSummary {
  id: string;
  batchId: string;
  batchIndex: number;
  batchSize: number;
  title?: string;
  promptPreview: string;
  wordCount: number;
  settings: GenerationSettings;
  media: MediaInput;
  endpoint: string;
  status: JobStatus;
  requestId?: string;
  videoUrl?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  finishedAt?: string;
}

export interface Job extends JobSummary {
  prompt: string;
}

export interface AppConfig {
  credentialsConfigured: boolean;
  /** Where the server runs, so the UI can explain how to add the key. */
  environment: 'local' | 'codespaces';
}
