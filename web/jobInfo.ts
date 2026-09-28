/** How a video (job) is labeled and sized on screen. */
import { inputLabel, modelById, qualityOf, type InputType } from '../shared/models.ts';
import type { JobStatus, JobSummary } from '../shared/types.ts';
import type { IconName } from './components/Icon.tsx';

export type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';

export const STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting to start', tone: 'neutral' },
  submitting: { label: 'Starting', tone: 'info' },
  queued: { label: 'Queued', tone: 'info' },
  in_progress: { label: 'Generating', tone: 'progress' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  nsfw: { label: 'Blocked by moderation', tone: 'warning' },
  canceled: { label: 'Canceled', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
};

export const MODE_ICON: Record<InputType, IconName> = {
  text: 'text',
  frames: 'frames',
  references: 'layers',
  edit: 'scissors',
  extend: 'arrow',
  motion: 'user',
  swap: 'refresh',
  'video-reference': 'film',
};

/** "Kling 3.0", "Pro", "Motion control", falling back gracefully for models no longer offered. */
export function describeJob(job: JobSummary): { model: string; quality: string; mode: string } {
  const model = modelById(job.settings.model);
  return {
    model: model?.name ?? job.settings.model,
    quality: (model && qualityOf(model, job.settings.quality)?.label) ?? job.settings.quality,
    mode: model ? inputLabel(model, job.media.mode) : job.media.mode,
  };
}

/** Modes whose video is as long as the uploaded one. */
const FROM_SOURCE: InputType[] = ['edit', 'motion', 'swap'];

/** Length of the finished video in seconds, when known before it plays. */
export function jobSeconds(job: JobSummary): number | undefined {
  if (FROM_SOURCE.includes(job.media.mode)) return job.media.sourceVideoSeconds;
  if (job.media.mode === 'extend') return (job.media.sourceVideoSeconds ?? 0) + job.settings.duration;
  return job.settings.duration;
}

/** Width ÷ height the video was asked for (16:9 when the model decides). */
export function jobRatio(job: JobSummary): number {
  const [w, h] = job.settings.aspectRatio.split(':').map(Number);
  return w && h && (job.media.mode === 'text' || job.media.mode === 'references') ? w / h : 16 / 9;
}

export function clock(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
