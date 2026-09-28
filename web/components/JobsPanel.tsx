import { memo, useMemo, useState } from 'react';
import { inputLabel, modelById, qualityOf, type InputType } from '../../shared/models.ts';
import { ACTIVE_STATUSES, type JobStatus, type JobSummary } from '../../shared/types.ts';
import { formatElapsed, formatNumber, plural, timeAgo } from '../format.ts';
import { Icon, type IconName } from './Icon.tsx';

type Tone = 'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'danger';

const STATUS: Record<JobStatus, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting to submit', tone: 'neutral' },
  submitting: { label: 'Submitting', tone: 'info' },
  queued: { label: 'Queued', tone: 'info' },
  in_progress: { label: 'Generating', tone: 'progress' },
  completed: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  nsfw: { label: 'Blocked by moderation', tone: 'warning' },
  canceled: { label: 'Canceled', tone: 'neutral' },
  error: { label: 'Error', tone: 'danger' },
};

const MODE_ICON: Record<InputType, IconName> = {
  text: 'text',
  frames: 'frames',
  references: 'layers',
  edit: 'scissors',
  extend: 'arrow',
  motion: 'user',
  swap: 'refresh',
  'video-reference': 'film',
};

/** "Kling 3.0 · Pro" for a job, falling back gracefully for models no longer offered. */
function describeJob(job: JobSummary): { model: string; quality: string; mode: string } {
  const model = modelById(job.settings.model);
  return {
    model: model?.name ?? job.settings.model,
    quality: (model && qualityOf(model, job.settings.quality)?.label) ?? job.settings.quality,
    mode: model ? inputLabel(model, job.media.mode) : job.media.mode,
  };
}

type Filter = 'all' | 'active' | 'completed' | 'attention';
const FILTERS: { id: Filter; label: string; test: (job: JobSummary) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'active', label: 'Running', test: (job) => ACTIVE_STATUSES.includes(job.status) },
  { id: 'completed', label: 'Completed', test: (job) => job.status === 'completed' },
  { id: 'attention', label: 'Needs attention', test: (job) => ['failed', 'nsfw', 'error'].includes(job.status) },
];

export interface JobActions {
  cancel: (id: string) => Promise<void>;
  refresh: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reuse: (id: string) => Promise<void>;
  fullPrompt: (id: string) => Promise<string>;
  copy: (text: string, what: string) => Promise<void>;
}

type Money = (cents: number) => string;

const JobCard = memo(function JobCard({ job, now, actions, money }: { job: JobSummary; now: number; actions: JobActions; money?: Money }) {
  const [busy, setBusy] = useState<string>();
  const [fullPrompt, setFullPrompt] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  const status = STATUS[job.status];
  const about = describeJob(job);
  const active = ACTIVE_STATUSES.includes(job.status);
  const truncated = job.promptPreview.endsWith('…');
  const since = Date.parse(job.submittedAt ?? job.createdAt);
  const elapsed = (job.finishedAt ? Date.parse(job.finishedAt) : now) - since;
  const images = [job.media.startImageUrl, job.media.endImageUrl, ...(job.media.referenceImageUrls ?? [])].filter(
    (url): url is string => typeof url === 'string',
  );
  const videoInputs = (job.media.sourceVideoUrl ? 1 : 0) + (job.media.referenceVideoUrls?.length ?? 0);
  const audioInputs = (job.media.soundtrackUrl ? 1 : 0) + (job.media.referenceAudioUrls?.length ?? 0);

  const run = (name: string, action: () => Promise<void>) => async () => {
    setBusy(name);
    try {
      await action();
    } finally {
      setBusy(undefined);
    }
  };

  const toggleFull = async () => {
    if (!expanded && fullPrompt === undefined) {
      setBusy('prompt');
      try {
        setFullPrompt(await actions.fullPrompt(job.id));
      } catch {
        // Keep the preview; the error is reported by the action.
      } finally {
        setBusy(undefined);
      }
    }
    setExpanded(!expanded);
  };

  return (
    <li className={`job-card tone-${status.tone}`}>
      <div className="job-top">
        <span className={`badge badge-${status.tone}`}>
          {active && <span className="pulse" aria-hidden="true" />}
          {status.label}
        </span>
        <span className="job-mode" title={job.endpoint}>
          <Icon name={MODE_ICON[job.media.mode] ?? 'film'} size={14} />
          {about.mode}
        </span>
        {job.refunded && (
          <span className="badge badge-neutral" title={money ? `${money(job.priceCents)} returned to your balance` : undefined}>
            <Icon name="wallet" size={12} />
            Refunded
          </span>
        )}
        {job.batchSize > 1 && (
          <span className="job-batch">
            #{job.batchIndex + 1} of {job.batchSize}
          </span>
        )}
        <span className="job-time" title={new Date(job.createdAt).toLocaleString()}>
          {timeAgo(job.createdAt, now)}
        </span>
      </div>

      {job.title && <h3 className="job-title">{job.title}</h3>}

      {job.status === 'completed' && job.videoUrl && (
        <video className="job-video" src={job.videoUrl} controls preload="metadata" playsInline />
      )}

      {active && (
        <div className="job-progress">
          <div className="progress-track">
            <span />
          </div>
          <span>
            {job.status === 'pending' ? 'In line to submit' : status.label} · {formatElapsed(elapsed)}
          </span>
        </div>
      )}

      <p className={expanded ? 'job-prompt is-expanded' : 'job-prompt'}>{expanded && fullPrompt !== undefined ? fullPrompt : job.promptPreview}</p>
      {truncated && (
        <button type="button" className="link-button" onClick={toggleFull} disabled={busy === 'prompt'}>
          {expanded ? 'Show less' : `Show full prompt (${plural(job.wordCount, 'word')})`}
        </button>
      )}

      <div className="job-meta">
        <span className="job-model">
          {about.model} · {about.quality}
        </span>
        {!['edit', 'motion', 'swap'].includes(job.media.mode) && <span>{job.settings.duration}s</span>}
        {job.media.mode === 'text' || job.media.mode === 'references' ? <span>{job.settings.aspectRatio === 'auto' ? 'auto ratio' : job.settings.aspectRatio}</span> : null}
        {videoInputs > 0 && <span>{videoInputs === 1 ? '1 video in' : `${videoInputs} videos in`}</span>}
        {audioInputs > 0 && <span>{audioInputs === 1 ? '1 audio in' : `${audioInputs} audio in`}</span>}
        {!active && job.finishedAt && <span>took {formatElapsed(elapsed)}</span>}
        {money && job.priceCents > 0 && <span className={job.refunded ? 'is-struck' : undefined}>{money(job.priceCents)}</span>}
      </div>

      {images.length > 0 && (
        <div className="job-images">
          {images.map((url, i) => (
            <img key={`${url}-${i}`} src={url} alt={`Input image ${i + 1}`} loading="lazy" />
          ))}
        </div>
      )}

      {job.error && job.status !== 'completed' && (
        <p className={`job-error tone-${status.tone}`}>
          <Icon name="alert" size={14} />
          <span>{job.error}</span>
        </p>
      )}

      <div className="job-actions">
        {job.status === 'completed' && job.videoUrl && (
          <>
            <a className="button button-small button-primary" href={`/api/jobs/${encodeURIComponent(job.id)}/download`} download>
              <Icon name="download" size={16} />
              Download
            </a>
            <a className="button button-small button-ghost" href={job.videoUrl} target="_blank" rel="noreferrer">
              <Icon name="external" size={16} />
              Open
            </a>
            <button type="button" className="button button-small button-ghost" onClick={() => void actions.copy(job.videoUrl!, 'Video link')}>
              <Icon name="link" size={16} />
              Copy link
            </button>
          </>
        )}
        {(job.status === 'pending' || job.status === 'queued') && (
          <button type="button" className="button button-small button-ghost" disabled={busy !== undefined} onClick={run('cancel', () => actions.cancel(job.id))}>
            <Icon name="stop" size={16} />
            Cancel
          </button>
        )}
        {(job.status === 'queued' || job.status === 'in_progress') && (
          <button type="button" className="button button-small button-ghost" disabled={busy !== undefined} onClick={run('refresh', () => actions.refresh(job.id))}>
            <Icon name="refresh" size={16} />
            Check now
          </button>
        )}
        {!active && job.status !== 'completed' && (
          <button type="button" className="button button-small" disabled={busy !== undefined} onClick={run('retry', () => actions.retry(job.id))}>
            <Icon name="refresh" size={16} />
            Retry
          </button>
        )}
        {!active && (
          <button type="button" className="button button-small button-ghost" disabled={busy !== undefined} onClick={run('reuse', () => actions.reuse(job.id))}>
            <Icon name="sparkles" size={16} />
            Reuse
          </button>
        )}
        {!active && (
          <button
            type="button"
            className="icon-button is-danger job-delete"
            title="Remove from history"
            aria-label="Remove from history"
            disabled={busy !== undefined}
            onClick={run('remove', () => actions.remove(job.id))}
          >
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>

      {job.requestId && (
        <button type="button" className="job-id" title="Copy request ID" onClick={() => void actions.copy(job.requestId!, 'Request ID')}>
          Request <code>{job.requestId}</code>
        </button>
      )}
    </li>
  );
});

export function JobsPanel({
  jobs,
  loaded,
  error,
  now,
  actions,
  money,
}: {
  jobs: JobSummary[];
  loaded: boolean;
  error?: string;
  now: number;
  actions: JobActions;
  /** Shows what each video cost when set. */
  money?: Money;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, jobs.filter(f.test).length])) as Record<Filter, number>, [jobs]);
  const visible = useMemo(() => jobs.filter(FILTERS.find((f) => f.id === filter)!.test), [jobs, filter]);

  return (
    <section className="jobs" aria-labelledby="jobs-title">
      <header className="jobs-header">
        <h2 id="jobs-title">My videos</h2>
        <div className="filters" role="group" aria-label="Filter videos">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} className={filter === f.id ? 'filter is-active' : 'filter'} onClick={() => setFilter(f.id)}>
              {f.label}
              <span className="count">{formatNumber(counts[f.id])}</span>
            </button>
          ))}
        </div>
      </header>

      {error && (
        <p className="banner banner-error">
          <Icon name="alert" size={16} />
          {error}
        </p>
      )}

      {!loaded ? (
        <ul className="job-list" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="job-card skeleton" />
          ))}
        </ul>
      ) : visible.length === 0 ? (
        <div className="empty">
          <Icon name="film" size={32} />
          <p>{filter === 'all' ? 'Your videos will appear here.' : 'Nothing here right now.'}</p>
          {filter === 'all' && <p className="hint">Write a prompt, choose the output, and press Generate.</p>}
        </div>
      ) : (
        <ul className="job-list">
          {visible.map((job) => (
            <JobCard key={job.id} job={job} now={now} actions={actions} money={money} />
          ))}
        </ul>
      )}
    </section>
  );
}
