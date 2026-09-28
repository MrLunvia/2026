import { useEffect, useState } from 'react';
import { ACTIVE_STATUSES, type JobSummary } from '../../shared/types.ts';
import { formatElapsed, plural, timeAgo } from '../format.ts';
import { MODE_ICON, STATUS, clock, describeJob, jobSeconds } from '../jobInfo.ts';
import { Dialog } from './Dialog.tsx';
import type { JobActions } from './Gallery.tsx';
import { Icon } from './Icon.tsx';

/** One video, large: player, full prompt, settings, inputs and every action. Arrow keys move between videos. */
export function VideoViewer({
  job,
  neighbors,
  now,
  actions,
  money,
  onNavigate,
  onClose,
}: {
  /** Open when set. */
  job?: JobSummary;
  /** The previous and next video in the gallery, if any. */
  neighbors: { previous?: string; next?: string };
  now: number;
  actions: JobActions;
  money: (cents: number) => string;
  onNavigate: (id: string) => void;
  onClose: () => void;
}) {
  const [fullPrompt, setFullPrompt] = useState<{ id: string; text: string }>();
  const [busy, setBusy] = useState<string>();
  const id = job?.id;
  const truncated = job?.promptPreview.endsWith('…') ?? false;

  // The list only carries a preview of long prompts; fetch the whole text for the open video.
  useEffect(() => {
    if (!id || !truncated || fullPrompt?.id === id) return;
    let cancelled = false;
    actions.fullPrompt(id).then(
      (text) => !cancelled && setFullPrompt({ id, text }),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [id, truncated, fullPrompt?.id, actions]);

  useEffect(() => {
    if (!id) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      // Arrow keys seek in a focused player and move the cursor in fields; a dialog on top (Delete?) keeps them too.
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT', 'VIDEO'].includes(target.tagName)) return;
      if (document.querySelectorAll('dialog[open]').length > 1) return;
      if (event.key === 'ArrowLeft' && neighbors.previous) onNavigate(neighbors.previous);
      if (event.key === 'ArrowRight' && neighbors.next) onNavigate(neighbors.next);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, neighbors.previous, neighbors.next, onNavigate]);

  if (!job) return null;

  const status = STATUS[job.status];
  const about = describeJob(job);
  const active = ACTIVE_STATUSES.includes(job.status);
  const done = job.status === 'completed' && job.videoUrl;
  const seconds = jobSeconds(job);
  const since = Date.parse(job.submittedAt ?? job.createdAt);
  const elapsed = (job.finishedAt ? Date.parse(job.finishedAt) : now) - since;
  const prompt = fullPrompt?.id === job.id ? fullPrompt.text : job.promptPreview;
  const images = [job.media.startImageUrl, job.media.endImageUrl, ...(job.media.referenceImageUrls ?? [])].filter((url): url is string => typeof url === 'string');
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

  return (
    <Dialog open size="full" className="viewer-dialog" title={job.title ?? `${about.model} video`} onClose={onClose}>
      <div className="viewer">
        <div className="viewer-stage">
          {done ? (
            <video key={job.id} className="viewer-video" src={job.videoUrl} controls autoPlay loop playsInline />
          ) : active ? (
            <div className="viewer-placeholder tile-pending">
              <span className="tile-status">
                <span className="spinner" />
                {job.status === 'pending' ? 'In line to start' : status.label}
              </span>
              <span className="tile-elapsed">{formatElapsed(elapsed)}</span>
              <span className="progress-track">
                <span />
              </span>
              <p className="muted">You can close this page; the video keeps generating.</p>
            </div>
          ) : (
            <div className="viewer-placeholder tile-failed">
              <Icon name={job.status === 'canceled' ? 'stop' : 'alert'} size={28} />
              <strong>{status.label}</strong>
              {job.error && <p>{job.error}</p>}
            </div>
          )}
          {neighbors.previous && (
            <button type="button" className="viewer-nav is-previous" onClick={() => onNavigate(neighbors.previous!)} aria-label="Previous video" title="Previous (←)">
              <Icon name="back" size={20} />
            </button>
          )}
          {neighbors.next && (
            <button type="button" className="viewer-nav is-next" onClick={() => onNavigate(neighbors.next!)} aria-label="Next video" title="Next (→)">
              <Icon name="arrow" size={20} />
            </button>
          )}
        </div>

        <aside className="viewer-side">
          <div className="viewer-status">
            <span className={`badge badge-${status.tone}`}>
              {active && <span className="pulse" aria-hidden="true" />}
              {status.label}
            </span>
            {job.refunded && <span className="badge badge-neutral">Refunded</span>}
            {job.featured && (
              <span className="badge badge-accent">
                <Icon name="star" size={11} />
                On the home page
              </span>
            )}
            <span className="muted" title={new Date(job.createdAt).toLocaleString()}>
              {timeAgo(job.createdAt, now)}
            </span>
          </div>

          <div className="viewer-prompt">
            <div className="viewer-label">
              Prompt
              {job.wordCount > 0 && <span className="muted">{plural(job.wordCount, 'word')}</span>}
              <button type="button" className="icon-button" title="Copy prompt" aria-label="Copy prompt" onClick={() => void actions.copy(prompt, 'Prompt')}>
                <Icon name="copy" size={15} />
              </button>
            </div>
            <p>{prompt || <em className="muted">No prompt</em>}</p>
          </div>

          <dl className="viewer-facts">
            <div>
              <dt>Model</dt>
              <dd>{about.model}</dd>
            </div>
            <div>
              <dt>Quality</dt>
              <dd>{about.quality}</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd className="viewer-mode">
                <Icon name={MODE_ICON[job.media.mode] ?? 'film'} size={14} />
                {about.mode}
              </dd>
            </div>
            <div>
              <dt>Length</dt>
              <dd>{seconds !== undefined ? clock(seconds) : 'Same as your video'}</dd>
            </div>
            <div>
              <dt>Aspect ratio</dt>
              <dd>{job.media.mode === 'text' || job.media.mode === 'references' ? (job.settings.aspectRatio === 'auto' ? 'Auto' : job.settings.aspectRatio) : 'From your input'}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd className={job.refunded ? 'is-struck' : undefined}>{money(job.priceCents)}</dd>
            </div>
            {!active && job.finishedAt && (
              <div>
                <dt>Took</dt>
                <dd>{formatElapsed(elapsed)}</dd>
              </div>
            )}
            {job.batchSize > 1 && (
              <div>
                <dt>Batch</dt>
                <dd>
                  {job.batchIndex + 1} of {job.batchSize}
                </dd>
              </div>
            )}
          </dl>

          {(images.length > 0 || videoInputs > 0 || audioInputs > 0) && (
            <div className="viewer-inputs">
              <div className="viewer-label">Inputs</div>
              {images.length > 0 && (
                <div className="job-images">
                  {images.map((url, i) => (
                    <img key={`${url}-${i}`} src={url} alt={`Input image ${i + 1}`} loading="lazy" />
                  ))}
                </div>
              )}
              {(videoInputs > 0 || audioInputs > 0) && (
                <p className="muted">
                  {[videoInputs > 0 && plural(videoInputs, 'video'), audioInputs > 0 && plural(audioInputs, 'audio file')].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>
          )}

          {job.error && !done && (
            <p className={`job-error tone-${status.tone}`}>
              <Icon name="alert" size={14} />
              <span>{job.error}</span>
            </p>
          )}

          <div className="viewer-actions">
            {done && (
              <>
                <a className="button button-primary" href={`/api/jobs/${encodeURIComponent(job.id)}/download`} download>
                  <Icon name="download" size={16} />
                  Download
                </a>
                <a className="button button-ghost" href={job.videoUrl} target="_blank" rel="noreferrer">
                  <Icon name="external" size={16} />
                  Open
                </a>
                <button type="button" className="button button-ghost" onClick={() => void actions.copy(job.videoUrl!, 'Video link')}>
                  <Icon name="link" size={16} />
                  Copy link
                </button>
              </>
            )}
            {(job.status === 'pending' || job.status === 'queued') && (
              <button type="button" className="button button-ghost" disabled={busy !== undefined} onClick={run('cancel', () => actions.cancel(job.id))}>
                <Icon name="stop" size={16} />
                Cancel
              </button>
            )}
            {(job.status === 'queued' || job.status === 'in_progress') && (
              <button type="button" className="button button-ghost" disabled={busy !== undefined} onClick={run('refresh', () => actions.refresh(job.id))}>
                <Icon name="refresh" size={16} />
                Check now
              </button>
            )}
            {!active && job.status !== 'completed' && (
              <button type="button" className="button button-primary" disabled={busy !== undefined} onClick={run('retry', () => actions.retry(job.id))}>
                <Icon name="refresh" size={16} />
                Retry
              </button>
            )}
            {!active && (
              <button type="button" className="button button-ghost" disabled={busy !== undefined} onClick={run('reuse', () => actions.reuse(job.id))}>
                <Icon name="wand" size={16} />
                Reuse
              </button>
            )}
            {done && actions.feature && (
              <button
                type="button"
                className="button button-ghost"
                disabled={busy !== undefined}
                onClick={run('feature', () => actions.feature!(job.id, !job.featured))}
              >
                <Icon name="star" size={16} />
                {job.featured ? 'Remove from home page' : 'Show on home page'}
              </button>
            )}
            {!active && (
              <button type="button" className="button button-ghost is-danger" disabled={busy !== undefined} onClick={run('remove', () => actions.remove(job.id))}>
                <Icon name="trash" size={16} />
                Delete
              </button>
            )}
          </div>

          {job.requestId && (
            <button type="button" className="job-id" title="Copy request ID" onClick={() => void actions.copy(job.requestId!, 'Request ID')}>
              Request <code>{job.requestId}</code>
            </button>
          )}
        </aside>
      </div>
    </Dialog>
  );
}
