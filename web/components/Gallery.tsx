import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ACTIVE_STATUSES, type JobSummary } from '../../shared/types.ts';
import { formatElapsed, formatNumber, timeAgo } from '../format.ts';
import { STATUS, clock, describeJob, jobRatio, jobSeconds } from '../jobInfo.ts';
import { Icon } from './Icon.tsx';
import { Inspiration } from './Inspiration.tsx';

type Money = (cents: number) => string;

export interface JobActions {
  cancel: (id: string) => Promise<void>;
  refresh: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reuse: (id: string) => Promise<void>;
  fullPrompt: (id: string) => Promise<string>;
  copy: (text: string, what: string) => Promise<void>;
  /** Owner only: show on the home page. */
  feature?: (id: string, featured: boolean) => Promise<void>;
}

type Filter = 'all' | 'active' | 'completed' | 'attention';
const FILTERS: { id: Filter; label: string; test: (job: JobSummary) => boolean }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'active', label: 'Running', test: (job) => ACTIVE_STATUSES.includes(job.status) },
  { id: 'completed', label: 'Completed', test: (job) => job.status === 'completed' },
  { id: 'attention', label: 'Needs attention', test: (job) => ['failed', 'nsfw', 'error'].includes(job.status) },
];

const MIN_TILE = 250;
/** Phones get two narrow columns rather than one wide one. */
const MIN_TILE_SMALL = 150;
const GAP = 14;
/** Tile text below the picture, as a share of the column width (for balancing columns). */
const INFO_SHARE = 0.34;

const VideoTile = memo(function VideoTile({
  job,
  now,
  ratio,
  actions,
  money,
  onOpen,
  onMeasured,
}: {
  job: JobSummary;
  now: number;
  ratio: number;
  actions: JobActions;
  money: Money;
  onOpen: (id: string) => void;
  onMeasured: (id: string, ratio: number) => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [busy, setBusy] = useState(false);
  const status = STATUS[job.status];
  const about = describeJob(job);
  const active = ACTIVE_STATUSES.includes(job.status);
  const done = job.status === 'completed' && job.videoUrl;
  const seconds = jobSeconds(job);
  const since = Date.parse(job.submittedAt ?? job.createdAt);
  const elapsed = (job.finishedAt ? Date.parse(job.finishedAt) : now) - since;
  const name = job.title ?? job.promptPreview;

  const play = () => {
    const v = video.current;
    if (v) void v.play().catch(() => undefined);
  };
  const stop = () => {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0.1;
  };
  const run = (action: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className={`tile tone-${status.tone}`} data-status={job.status} onMouseEnter={play} onMouseLeave={stop}>
      <button type="button" className="tile-open" onClick={() => onOpen(job.id)} onFocus={play} onBlur={stop} aria-label={`Open video: ${name.slice(0, 120)}`}>
        <span className="tile-media" style={{ aspectRatio: String(ratio) }}>
          {done ? (
            <video
              ref={video}
              src={`${job.videoUrl}#t=0.1`}
              muted
              loop
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const { videoWidth, videoHeight } = e.currentTarget;
                if (videoWidth > 0 && videoHeight > 0) onMeasured(job.id, videoWidth / videoHeight);
              }}
            />
          ) : active ? (
            <span className="tile-pending">
              <span className="tile-status">
                <span className="spinner" />
                {job.status === 'pending' ? 'In line' : status.label}
              </span>
              <span className="tile-elapsed">{formatElapsed(elapsed)}</span>
              <span className="progress-track">
                <span />
              </span>
            </span>
          ) : (
            <span className="tile-failed">
              <Icon name={job.status === 'canceled' ? 'stop' : 'alert'} size={22} />
              <strong>{status.label}</strong>
              {job.refunded && <span>{money(job.priceCents)} refunded</span>}
            </span>
          )}
          <span className="tile-badges">
            {done && job.refunded && <span className="badge badge-neutral">Refunded</span>}
            {job.featured && (
              <span className="badge badge-accent" title="Shown on the home page">
                <Icon name="star" size={11} />
                <span className="sr-only">On the home page</span>
              </span>
            )}
            {job.batchSize > 1 && (
              <span className="badge badge-dark">
                {job.batchIndex + 1}/{job.batchSize}
              </span>
            )}
          </span>
          {done && seconds !== undefined && <span className="tile-length">{clock(seconds)}</span>}
          {done && (
            <span className="tile-play" aria-hidden="true">
              <Icon name="play" size={18} />
            </span>
          )}
        </span>
        <span className="tile-info">
          <span className="tile-prompt">
            {job.title && <strong>{job.title} · </strong>}
            {job.promptPreview || <em className="muted">No prompt</em>}
          </span>
          {job.error && !done && <span className={`tile-error tone-${status.tone}`}>{job.error}</span>}
          <span className="tile-meta">
            <span className="tile-model">
              {about.model} · {about.quality}
            </span>
            {job.priceCents > 0 && <span className={job.refunded ? 'is-struck' : undefined}>{money(job.priceCents)}</span>}
            <span title={new Date(job.createdAt).toLocaleString()}>{timeAgo(job.createdAt, now)}</span>
          </span>
        </span>
      </button>

      <div className="tile-actions">
        {done && (
          <a className="icon-button" href={`/api/jobs/${encodeURIComponent(job.id)}/download`} download title="Download" aria-label="Download">
            <Icon name="download" size={16} />
          </a>
        )}
        {(job.status === 'pending' || job.status === 'queued') && (
          <button type="button" className="icon-button" title="Cancel and refund" aria-label="Cancel and refund" disabled={busy} onClick={run(() => actions.cancel(job.id))}>
            <Icon name="stop" size={16} />
          </button>
        )}
        {!active && job.status !== 'completed' && (
          <button type="button" className="icon-button" title="Try again" aria-label="Try again" disabled={busy} onClick={run(() => actions.retry(job.id))}>
            <Icon name="refresh" size={16} />
          </button>
        )}
        {!active && (
          <button type="button" className="icon-button" title="Reuse prompt and settings" aria-label="Reuse prompt and settings" disabled={busy} onClick={run(() => actions.reuse(job.id))}>
            <Icon name="wand" size={16} />
          </button>
        )}
      </div>
    </article>
  );
});

/** Newest first, spread over columns so each new tile lands in the shortest one. */
function useColumns(jobs: JobSummary[], ratios: Record<string, number>, count: number): JobSummary[][] {
  return useMemo(() => {
    const columns: JobSummary[][] = Array.from({ length: count }, () => []);
    const heights = new Array<number>(count).fill(0);
    for (const job of jobs) {
      const shortest = heights.indexOf(Math.min(...heights));
      columns[shortest]!.push(job);
      heights[shortest]! += 1 / (ratios[job.id] ?? jobRatio(job)) + INFO_SHARE;
    }
    return columns;
  }, [jobs, ratios, count]);
}

export function Gallery({
  jobs,
  loaded,
  error,
  now,
  actions,
  money,
  onOpen,
  onInspire,
}: {
  jobs: JobSummary[];
  loaded: boolean;
  error?: string;
  now: number;
  actions: JobActions;
  money: Money;
  onOpen: (id: string) => void;
  onInspire: (text: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const [count, setCount] = useState(3);
  const grid = useRef<HTMLDivElement>(null);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, jobs.filter(f.test).length])) as Record<Filter, number>, [jobs]);
  const visible = useMemo(() => jobs.filter(FILTERS.find((f) => f.id === filter)!.test), [jobs, filter]);
  const columns = useColumns(visible, ratios, count);

  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const min = width < 560 ? MIN_TILE_SMALL : MIN_TILE;
      setCount(Math.max(1, Math.min(5, Math.floor((width + GAP) / (min + GAP)))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [loaded, visible.length === 0]);

  const onMeasured = useCallback((id: string, ratio: number) => {
    setRatios((all) => (all[id] !== undefined && Math.abs(all[id]! - ratio) < 0.02 ? all : { ...all, [id]: ratio }));
  }, []);

  return (
    <section className="gallery" aria-labelledby="gallery-title">
      <header className="gallery-head">
        <h2 id="gallery-title">
          My videos
          <span className="count">{formatNumber(jobs.length)}</span>
        </h2>
        <div className="filters" role="group" aria-label="Filter videos">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} className={filter === f.id ? 'filter is-active' : 'filter'} onClick={() => setFilter(f.id)}>
              {f.label}
              {f.id !== 'all' && counts[f.id] > 0 && <span className="count">{formatNumber(counts[f.id])}</span>}
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
        <div className="masonry" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="masonry-column">
              <div className="tile skeleton" style={{ aspectRatio: i === 1 ? '4 / 5' : '16 / 11' }} />
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <Inspiration onUse={onInspire} />
      ) : visible.length === 0 ? (
        <div className="empty">
          <Icon name="film" size={30} />
          <p>Nothing here right now.</p>
        </div>
      ) : (
        <div className="masonry" ref={grid}>
          {columns.map((column, i) => (
            <div key={i} className="masonry-column">
              {column.map((job) => (
                <VideoTile
                  key={job.id}
                  job={job}
                  now={now}
                  ratio={ratios[job.id] ?? jobRatio(job)}
                  actions={actions}
                  money={money}
                  onOpen={onOpen}
                  onMeasured={onMeasured}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
