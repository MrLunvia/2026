/**
 * Generation jobs for every customer, stored in SQLite. Customers pay when jobs are created; the
 * runner submits pending jobs a few at a time and polls Higgsfield until each finishes. A job that
 * ends without a video (failed, moderated, canceled, never sent) is refunded exactly once.
 *
 * If Higgsfield rejects the platform's key or its credit runs out (401/403) or rate-limits (429),
 * submissions pause and jobs wait in line instead of failing, so topping up resumes the queue.
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_MODEL } from '../shared/models.ts';
import { mediaCounts, quote } from '../shared/pricing.ts';
import { countWords, shorten } from '../shared/text.ts';
import type { AdminJobRow, CreateJobsRequest, GenerationSettings, Job, JobStatus, JobSummary, MediaInput, ServiceStatus, ShowcaseItem } from '../shared/types.ts';
import type { Billing } from './billing.ts';
import { nowIso, type DB } from './db.ts';
import { HiggsfieldError, isAcceptableUrl, type HiggsfieldApi, type RemoteStatus } from './higgsfield.ts';
import { HttpProblem, toHiggsfieldRequest } from './requests.ts';

const PREVIEW_CHARS = 280;
const ACTIVE = ['pending', 'submitting', 'queued', 'in_progress'];

export interface JobRow {
  id: string;
  user_id: string;
  batch_id: string;
  batch_index: number;
  batch_size: number;
  title: string | null;
  prompt: string;
  prompt_preview: string;
  word_count: number;
  settings: string;
  media: string;
  endpoint: string;
  status: JobStatus;
  request_id: string | null;
  video_url: string | null;
  error: string | null;
  detail: string | null;
  price_cents: number;
  refunded_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
  finished_at: string | null;
  featured_at: string | null;
}

/** Jobs from before other models existed stored Seedance 2.5's resolution instead of a model and quality. */
function storedSettings(raw: string): GenerationSettings {
  const s = JSON.parse(raw) as Partial<GenerationSettings> & { resolution?: string };
  return {
    model: s.model ?? DEFAULT_MODEL,
    quality: s.quality ?? s.resolution ?? '720p',
    duration: s.duration ?? 5,
    aspectRatio: s.aspectRatio ?? '16:9',
    generateAudio: s.generateAudio ?? true,
  };
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    batchId: row.batch_id,
    batchIndex: row.batch_index,
    batchSize: row.batch_size,
    title: row.title ?? undefined,
    prompt: row.prompt,
    promptPreview: row.prompt_preview,
    wordCount: row.word_count,
    settings: storedSettings(row.settings),
    media: JSON.parse(row.media),
    endpoint: row.endpoint,
    status: row.status,
    requestId: row.request_id ?? undefined,
    videoUrl: row.video_url ?? undefined,
    error: row.error ?? undefined,
    priceCents: row.price_cents,
    refunded: row.refunded_at !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at ?? undefined,
    finishedAt: row.finished_at ?? undefined,
    ...(row.featured_at ? { featured: true } : {}),
  };
}

function summarize({ prompt: _prompt, ...summary }: Job): JobSummary {
  return summary;
}

function preview(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

/** Provider reasons about the platform's own account (credit, keys, limits) are for the admin, not the customer. */
function customerReason(reason: string | undefined): string | undefined {
  if (!reason || /credit|balance|billing|quota|subscription|api[ _-]?key|unauthori[sz]ed|forbidden|rate.?limit|higgsfield/i.test(reason)) return undefined;
  return shorten(reason, 300);
}

/** What a ledger line calls a video: its title, or the start of its prompt. */
const videoName = (row: { title: string | null; prompt_preview: string }) => shorten(row.title ?? row.prompt_preview, 80);

const REFUND_NOTE: Record<'failed' | 'nsfw' | 'canceled' | 'error', string> = {
  failed: 'Video failed',
  nsfw: 'Blocked by the content filter',
  canceled: 'Canceled',
  error: 'Video could not be made',
};

/** Settings sent to Higgsfield, for the log: no prompt text, no image links. */
function describeInput(input: Record<string, unknown>): string {
  return Object.entries(input)
    .filter(([key]) => key !== 'prompt')
    .map(([key, value]) => `${key}=${Array.isArray(value) ? `${value.length} item(s)` : typeof value === 'string' && /^https?:/i.test(value) ? 'set' : String(value)}`)
    .join(' ');
}

type Patch = { status?: JobStatus; requestId?: string; videoUrl?: string; error?: string; detail?: string; submittedAt?: string; finishedAt?: string };
const COLUMNS: Record<keyof Patch, string> = {
  status: 'status',
  requestId: 'request_id',
  videoUrl: 'video_url',
  error: 'error',
  detail: 'detail',
  submittedAt: 'submitted_at',
  finishedAt: 'finished_at',
};

export class JobStore {
  private readonly boot = randomUUID().slice(0, 8);
  private readonly versions = new Map<string, number>();

  constructor(private readonly db: DB) {}

  /** Changes whenever one of this customer's jobs changes; lets the page poll cheaply. */
  etag(userId: string): string {
    return `"${this.boot}-${this.versions.get(userId) ?? 0}"`;
  }

  changed(userId: string): void {
    this.versions.set(userId, (this.versions.get(userId) ?? 0) + 1);
  }

  row(id: string): JobRow | undefined {
    return this.db.prepare<[string], JobRow>('SELECT * FROM jobs WHERE id = ?').get(id);
  }

  /** A customer's own, not-deleted job. */
  owned(id: string, userId: string): JobRow {
    const row = this.row(id);
    if (!row || row.user_id !== userId || row.deleted_at) throw new HttpProblem(404, 'No such video');
    return row;
  }

  full(row: JobRow): Job {
    return toJob(row);
  }

  list(userId: string, limit = 300): JobSummary[] {
    return this.db
      .prepare<[string, number], JobRow>('SELECT * FROM jobs WHERE user_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, batch_index ASC LIMIT ?')
      .all(userId, limit)
      .map((row) => summarize(toJob(row)));
  }

  listAll(limit = 200): AdminJobRow[] {
    return this.db
      .prepare<[number], JobRow & { email: string }>(
        'SELECT j.*, u.email FROM jobs j JOIN users u ON u.id = j.user_id ORDER BY j.created_at DESC, j.batch_index ASC LIMIT ?',
      )
      .all(limit)
      .map((row) => ({ ...summarize(toJob(row)), userId: row.user_id, userEmail: row.email, detail: row.detail ?? undefined }));
  }

  insert(userId: string, jobs: Job[]): void {
    const insert = this.db.prepare(
      `INSERT INTO jobs (id, user_id, batch_id, batch_index, batch_size, title, prompt, prompt_preview, word_count, settings, media,
         endpoint, status, price_cents, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const job of jobs) {
      insert.run(job.id, userId, job.batchId, job.batchIndex, job.batchSize, job.title ?? null, job.prompt, job.promptPreview, job.wordCount,
        JSON.stringify(job.settings), JSON.stringify(job.media), job.endpoint, job.status, job.priceCents, job.createdAt, job.updatedAt);
    }
    this.changed(userId);
  }

  update(row: JobRow, patch: Patch): void {
    const keys = Object.keys(patch) as (keyof Patch)[];
    const sets = keys.map((key) => `${COLUMNS[key]} = @${key}`);
    this.db
      .prepare(`UPDATE jobs SET ${[...sets, 'updated_at = @updatedAt'].join(', ')} WHERE id = @id`)
      .run({ ...Object.fromEntries(keys.map((key) => [key, patch[key] ?? null])), updatedAt: nowIso(), id: row.id });
    Object.assign(row, Object.fromEntries(keys.map((key) => [COLUMNS[key], patch[key] ?? null])));
    this.changed(row.user_id);
  }

  softDelete(row: JobRow): void {
    this.db.prepare('UPDATE jobs SET deleted_at = ? WHERE id = ?').run(nowIso(), row.id);
    this.changed(row.user_id);
  }

  /** Show (or stop showing) a finished video on the home page. */
  setFeatured(row: JobRow, featured: boolean): void {
    if (featured && (row.status !== 'completed' || !row.video_url)) throw new HttpProblem(400, 'Only finished videos can go on the home page');
    const at = featured ? (row.featured_at ?? nowIso()) : null;
    this.db.prepare('UPDATE jobs SET featured_at = ? WHERE id = ?').run(at, row.id);
    row.featured_at = at;
    this.changed(row.user_id);
  }

  /** Videos on the home page, newest pick first. Nothing about who made them. */
  showcase(limit = 12): ShowcaseItem[] {
    return this.db
      .prepare<[number], JobRow>(
        "SELECT * FROM jobs WHERE featured_at IS NOT NULL AND deleted_at IS NULL AND status = 'completed' AND video_url IS NOT NULL ORDER BY featured_at DESC LIMIT ?",
      )
      .all(limit)
      .filter((row) => isAcceptableUrl(row.video_url!))
      .map((row) => {
        const settings = storedSettings(row.settings);
        return {
          id: row.id,
          videoUrl: row.video_url!,
          ...(row.title ? { title: row.title } : {}),
          promptPreview: row.prompt_preview,
          model: settings.model,
          quality: settings.quality,
          aspectRatio: settings.aspectRatio,
          duration: settings.duration,
        };
      });
  }

  countActive(userId: string): number {
    return this.db
      .prepare<[string], { n: number }>("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND status IN ('pending', 'submitting', 'queued', 'in_progress')")
      .get(userId)!.n;
  }

  withStatus(...statuses: JobStatus[]): JobRow[] {
    return this.db
      .prepare<JobStatus[], JobRow>(`SELECT * FROM jobs WHERE status IN (${statuses.map(() => '?').join(',')}) ORDER BY created_at, batch_index`)
      .all(...statuses);
  }
}

export interface RunnerOptions {
  pollIntervalMs: number;
  /** Refund and stop waiting when a submitted job has no final state after this long. */
  maxWaitMs: number;
  /** Refund jobs that could not even be submitted within this long (e.g. a long pause). */
  maxPendingMs: number;
  submitConcurrency: number;
  pollConcurrency: number;
  maxActivePerUser: number;
}

export class JobRunner {
  private inFlight = 0;
  private polling = false;
  private timer: NodeJS.Timeout | undefined;
  private pause: { until: number; reason: string } | undefined;

  constructor(
    private readonly db: DB,
    private readonly store: JobStore,
    private readonly billing: Billing,
    private readonly api: HiggsfieldApi | undefined,
    private readonly options: RunnerOptions,
  ) {}

  start(): void {
    // A submit cut off by a restart may or may not have reached Higgsfield: refund it, never resend it.
    for (const row of this.store.withStatus('submitting')) {
      this.end(row, 'error', 'The server restarted while sending this video.', 'Interrupted during submission; outcome unknown');
    }
    this.timer = setInterval(() => {
      void this.pollActive();
      void this.drain();
    }, this.options.pollIntervalMs);
    void this.drain();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  serviceStatus(): ServiceStatus {
    if (!this.api) return { paused: true, reason: 'HF_CREDENTIALS is not configured' };
    if (this.pause && this.pause.until > Date.now()) {
      return { paused: true, reason: this.pause.reason, until: new Date(this.pause.until).toISOString() };
    }
    return { paused: false };
  }

  /** Adds the lengths the server measured for this customer's uploaded videos (prices depend on them). */
  private measured(userId: string, media: MediaInput): MediaInput {
    const lookup = this.db.prepare<[string, string], { seconds: number | null }>("SELECT seconds FROM uploads WHERE url = ? AND user_id = ? AND kind = 'video'");
    const seconds = (url: string) => {
      const found = lookup.get(url, userId)?.seconds;
      if (found === undefined || found === null) throw new HttpProblem(400, 'Upload videos on this site so their length (and price) can be worked out.');
      return found;
    };
    const { sourceVideoSeconds: _s, referenceVideoSeconds: _r, ...rest } = media;
    return {
      ...rest,
      ...(media.sourceVideoUrl ? { sourceVideoSeconds: seconds(media.sourceVideoUrl) } : {}),
      ...(media.referenceVideoUrls?.length ? { referenceVideoSeconds: media.referenceVideoUrls.map(seconds) } : {}),
    };
  }

  /**
   * Charge the customer and queue the videos, all or nothing. `expected` is what the page showed
   * (the batch total, or the per-video price from older pages); a different price is refused.
   */
  enqueue(userId: string, request: CreateJobsRequest, expected: { totalCents?: number; perVideoCents?: number } = {}): Job[] {
    if (!this.api) throw new HttpProblem(503, 'Video generation is not available right now.');
    const pricing = this.billing.pricing();
    const priced = request.prompts.map((p, i) => {
      const media = this.measured(userId, p.media);
      const q = quote(pricing, request.settings, mediaCounts(media), p.prompt);
      if (q.cents === undefined || q.problems.length > 0) throw new HttpProblem(400, `Prompt ${i + 1}: ${q.problems[0] ?? 'this can’t be made'}`);
      return { ...p, media, priceCents: q.cents };
    });
    const total = priced.reduce((sum, p) => sum + p.priceCents, 0);
    if (
      (expected.totalCents !== undefined && expected.totalCents !== total) ||
      (expected.perVideoCents !== undefined && priced.some((p) => p.priceCents !== expected.perVideoCents))
    ) {
      throw new HttpProblem(409, 'Prices have changed. Please review the new price and try again.');
    }
    const batchId = randomUUID();
    const createdAt = nowIso();
    const jobs = priced.map((p, batchIndex): Job => ({
      id: randomUUID(),
      batchId,
      batchIndex,
      batchSize: request.prompts.length,
      title: p.title,
      prompt: p.prompt,
      promptPreview: preview(p.prompt),
      wordCount: countWords(p.prompt),
      settings: request.settings,
      media: p.media,
      endpoint: toHiggsfieldRequest(p.prompt, request.settings, p.media).endpoint,
      status: 'pending',
      priceCents: p.priceCents,
      refunded: false,
      createdAt,
      updatedAt: createdAt,
    }));
    this.db.transaction(() => {
      if (this.store.countActive(userId) + jobs.length > this.options.maxActivePerUser) {
        throw new HttpProblem(429, `You can have up to ${this.options.maxActivePerUser} videos in progress at once. Wait for some to finish.`);
      }
      this.store.insert(userId, jobs);
      for (const job of jobs) {
        if (job.priceCents > 0) this.billing.move(userId, -job.priceCents, 'generation', { jobId: job.id, note: shorten(job.title ?? job.promptPreview, 80) });
      }
    })();
    void this.drain();
    return jobs;
  }

  /** A new video with the same prompt, media and settings (charged again, at today's price). */
  retry(id: string, userId: string, expectedPriceCents?: number): Job {
    const row = this.store.owned(id, userId);
    if (ACTIVE.includes(row.status)) throw new HttpProblem(409, 'This video is still being made');
    const job = toJob(row);
    return this.enqueue(userId, { settings: job.settings, prompts: [{ title: job.title, prompt: job.prompt, media: job.media }] }, { totalCents: expectedPriceCents })[0]!;
  }

  async cancel(id: string, userId: string): Promise<JobRow> {
    const row = this.store.owned(id, userId);
    if (row.status === 'pending') {
      this.end(row, 'canceled', 'Canceled before it started.');
      return row;
    }
    if (row.status === 'queued' && row.request_id && this.api) {
      const result = await this.api.cancel(row.request_id).catch(() => 'error' as const);
      if (result === 'canceled') {
        this.end(row, 'canceled', 'Canceled.');
        return row;
      }
      await this.poll(row);
    }
    if (row.status === 'queued' || row.status === 'in_progress' || row.status === 'submitting') {
      throw new HttpProblem(409, 'This video has already started and can no longer be canceled');
    }
    throw new HttpProblem(409, 'This video has already finished');
  }

  async refresh(id: string, userId: string): Promise<JobRow> {
    const row = this.store.owned(id, userId);
    if (row.status === 'queued' || row.status === 'in_progress') await this.poll(row);
    return row;
  }

  remove(id: string, userId: string): void {
    const row = this.store.owned(id, userId);
    if (ACTIVE.includes(row.status)) throw new HttpProblem(409, 'Cancel or wait for this video before deleting it');
    this.store.softDelete(row);
  }

  /** Admin: give a charge back (e.g. a completed video the customer was unhappy with). */
  adminRefund(id: string, adminEmail: string): boolean {
    const row = this.store.row(id);
    if (!row) throw new HttpProblem(404, 'No such job');
    if (ACTIVE.includes(row.status)) throw new HttpProblem(409, 'Wait for this video to finish first');
    const refunded = this.billing.refundJob(row, `Refunded by support · ${videoName(row)}`, adminEmail);
    if (refunded) this.store.changed(row.user_id);
    return refunded;
  }

  private async drain(): Promise<void> {
    if (!this.api || this.serviceStatus().paused) return;
    while (this.inFlight < this.options.submitConcurrency) {
      const row = this.db.transaction(() => {
        const next = this.store.withStatus('pending')[0];
        if (next) this.store.update(next, { status: 'submitting' });
        return next;
      })();
      if (!row) return;
      this.inFlight++;
      void this.submit(row).finally(() => {
        this.inFlight--;
        void this.drain();
      });
    }
  }

  private async submit(row: JobRow): Promise<void> {
    const job = toJob(row);
    let request: ReturnType<typeof toHiggsfieldRequest>;
    try {
      request = toHiggsfieldRequest(job.prompt, job.settings, job.media);
    } catch (error) {
      // The model's options changed since this job was queued (e.g. after an update).
      this.end(row, 'error', 'These settings are no longer available for this model.', (error as Error).message);
      return;
    }
    const { endpoint, input } = request;
    try {
      const accepted = await this.api!.submit(endpoint, input);
      this.store.update(row, {
        status: accepted.status === 'in_progress' ? 'in_progress' : 'queued',
        requestId: accepted.requestId,
        submittedAt: nowIso(),
      });
      console.log(`Submitted job ${row.id} (user ${row.user_id}) -> request ${accepted.requestId} (${endpoint}; ${describeInput(input)})`);
    } catch (error) {
      const problem = error instanceof HiggsfieldError ? error : new HiggsfieldError(String(error));
      const status = problem.httpStatus;
      if (status === 401 || status === 403 || status === 429) {
        // Account-level trouble (bad key, no Higgsfield credit, rate limit): nothing was generated,
        // so put the job back in line and hold submissions for a while.
        const minutes = status === 429 ? 1 : 5;
        this.pause = { until: Date.now() + minutes * 60_000, reason: problem.message };
        this.store.update(row, { status: 'pending' });
        console.error(`Submissions paused for ${minutes} min: ${problem.message}`);
        return;
      }
      if (status === 400 || status === 422) {
        this.end(row, 'error', `The video service rejected this request: ${problem.message.replace(/^Invalid input \(HTTP \d+\): /, '')}.`, problem.message);
      } else {
        this.end(row, 'error', 'The video service is unavailable right now. Please try again later.', problem.message);
      }
    }
  }

  private async pollActive(): Promise<void> {
    if (this.polling || !this.api) return;
    this.polling = true;
    try {
      const rows = this.store.withStatus('queued', 'in_progress').filter((row) => row.request_id);
      for (let i = 0; i < rows.length; i += this.options.pollConcurrency) {
        await Promise.all(rows.slice(i, i + this.options.pollConcurrency).map((row) => this.poll(row)));
      }
      const stale = Date.now() - this.options.maxPendingMs;
      for (const row of this.store.withStatus('pending')) {
        if (Date.parse(row.created_at) < stale) this.end(row, 'error', 'The video could not be started in time.', this.pause?.reason ?? 'Pending too long');
      }
    } finally {
      this.polling = false;
    }
  }

  private async poll(row: JobRow): Promise<void> {
    if (!this.api || !row.request_id) return;
    try {
      this.apply(row, await this.api.status(row.request_id));
    } catch (error) {
      if (error instanceof HiggsfieldError && error.httpStatus === 404) {
        this.end(row, 'error', 'The video service lost track of this request.', 'Status returned HTTP 404');
        return;
      }
      // Network trouble, 5xx, 429: keep waiting; the next tick tries again.
    }
    const started = Date.parse(row.submitted_at ?? row.created_at);
    if ((row.status === 'queued' || row.status === 'in_progress') && Date.now() - started > this.options.maxWaitMs) {
      this.end(row, 'error', 'The video took too long to finish.', `No final status after ${Math.round(this.options.maxWaitMs / 60_000)} minutes`);
    }
  }

  private apply(row: JobRow, remote: RemoteStatus): void {
    switch (remote.status) {
      case 'queued':
      case 'in_progress':
        if (row.status !== remote.status) this.store.update(row, { status: remote.status });
        return;
      case 'completed':
        if (remote.videoUrl) {
          this.store.update(row, { status: 'completed', videoUrl: remote.videoUrl, finishedAt: nowIso() });
          console.log(`Job ${row.id} completed (request ${row.request_id})`);
        } else {
          this.end(row, 'error', 'The video service finished without returning a video.', 'Completed without video.url');
        }
        return;
      case 'failed': {
        const reason = customerReason(remote.reason);
        this.end(row, 'failed', `The video could not be generated${reason ? `: ${reason}` : ''}.`, remote.reason);
        return;
      }
      case 'nsfw': {
        const reason = customerReason(remote.reason);
        this.end(row, 'nsfw', `Blocked by the content filter${reason ? `: ${reason}` : ''}. Try rephrasing your prompt.`, remote.reason);
        return;
      }
      case 'canceled':
        this.end(row, 'canceled', 'Canceled.', remote.reason);
        return;
      default:
      // Unknown state: keep polling.
    }
  }

  /** Final state without a video: refund once, and tell the customer. */
  private end(row: JobRow, status: 'failed' | 'nsfw' | 'canceled' | 'error', message: string, detail?: string): void {
    this.db.transaction(() => {
      const refunded = row.price_cents > 0 && this.billing.refundJob(row, `${REFUND_NOTE[status]} · ${videoName(row)}`);
      this.store.update(row, {
        status,
        error: refunded ? `${message} Your credit was refunded.` : message,
        detail: detail ?? message,
        finishedAt: nowIso(),
      });
    })();
    console.warn(`Job ${row.id} (user ${row.user_id}, request ${row.request_id ?? 'none'}) ended ${status}: ${detail ?? message}`);
  }
}
