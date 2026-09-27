/**
 * Generation jobs: a persisted history (data/jobs.json) plus a runner that submits pending jobs
 * one at a time and polls Higgsfield until each reaches a final state.
 *
 * Billing safety: a submission is never retried automatically, and nothing is resumed after a
 * restart - unsent jobs stop, and a job interrupted mid-submit is flagged for manual checking.
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { countWords } from '../shared/text.ts';
import { ACTIVE_STATUSES, type CreateJobsRequest, type Job, type JobStatus, type JobSummary } from '../shared/types.ts';
import { HiggsfieldError, type HiggsfieldApi, type RemoteStatus } from './higgsfield.ts';
import { HttpProblem, toHiggsfieldRequest } from './requests.ts';

const PREVIEW_CHARS = 280;
const LIST_LIMIT = 500;

const nowIso = () => new Date().toISOString();

function summarize({ prompt: _prompt, ...summary }: Job): JobSummary {
  return summary;
}

function preview(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  return flat.length > PREVIEW_CHARS ? `${flat.slice(0, PREVIEW_CHARS)}…` : flat;
}

export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private version = 1;
  private saveTimer: NodeJS.Timeout | undefined;
  private saving: Promise<void> = Promise.resolve();

  constructor(private readonly file: string) {}

  /** Changes whenever any job changes; lets the UI poll cheaply with If-None-Match. */
  get etag(): string {
    return `"jobs-${this.version}"`;
  }

  async load(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    let saved: { jobs?: Job[] };
    try {
      saved = JSON.parse(raw);
    } catch {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      await rename(this.file, backup);
      console.warn(`Job history was unreadable; moved it to ${backup} and started fresh.`);
      return;
    }
    const now = nowIso();
    let changed = false;
    for (const job of saved.jobs ?? []) {
      if (job.status === 'pending') {
        Object.assign(job, { status: 'error', error: 'Not submitted: the server restarted first. Use Retry to submit it.', updatedAt: now, finishedAt: now });
        changed = true;
      } else if (job.status === 'submitting') {
        Object.assign(job, {
          status: 'error',
          error: 'The server stopped while submitting this job; check your Higgsfield console before retrying.',
          updatedAt: now,
          finishedAt: now,
        });
        changed = true;
      }
      this.jobs.set(job.id, job);
    }
    if (changed) this.changed();
  }

  all(): Job[] {
    return [...this.jobs.values()];
  }

  list(): JobSummary[] {
    return this.all()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.batchIndex - b.batchIndex)
      .slice(0, LIST_LIMIT)
      .map(summarize);
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  require(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new HttpProblem(404, 'No such job');
    return job;
  }

  add(jobs: Job[]): void {
    for (const job of jobs) this.jobs.set(job.id, job);
    this.changed();
  }

  update(id: string, patch: Partial<Job>): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    Object.assign(job, patch, { updatedAt: nowIso() });
    this.changed();
    return job;
  }

  remove(id: string): void {
    if (this.jobs.delete(id)) this.changed();
  }

  nextPending(): Job | undefined {
    return this.all()
      .filter((job) => job.status === 'pending')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.batchIndex - b.batchIndex)[0];
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      await this.save();
    } else {
      await this.saving;
    }
  }

  private changed(): void {
    this.version++;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.save();
    }, 300);
  }

  private save(): Promise<void> {
    const data = JSON.stringify({ jobs: this.all() });
    this.saving = this.saving
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true });
        const temp = `${this.file}.tmp`;
        await writeFile(temp, data);
        await rename(temp, this.file);
      })
      .catch((error: Error) => console.error(`Could not save job history: ${error.message}`));
    return this.saving;
  }
}

export interface RunnerOptions {
  pollIntervalMs: number;
  /** Stop waiting (and flag the job) when a request has no final state after this long. */
  maxWaitMs: number;
}

export class JobRunner {
  private submitting = false;
  private polling = false;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly store: JobStore,
    private readonly api: HiggsfieldApi | undefined,
    private readonly options: RunnerOptions,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.pollActive(), this.options.pollIntervalMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  enqueue(request: CreateJobsRequest): Job[] {
    const batchId = randomUUID();
    const createdAt = nowIso();
    const jobs = request.prompts.map((p, batchIndex): Job => ({
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
      createdAt,
      updatedAt: createdAt,
    }));
    this.store.add(jobs);
    void this.drain();
    return jobs;
  }

  /** A new job with the same prompt, settings and images (a new billable generation). */
  retry(id: string): Job {
    const job = this.store.require(id);
    if (ACTIVE_STATUSES.includes(job.status)) throw new HttpProblem(409, 'This job is still running');
    return this.enqueue({ settings: job.settings, prompts: [{ title: job.title, prompt: job.prompt, media: job.media }] })[0]!;
  }

  async cancel(id: string): Promise<Job> {
    const job = this.store.require(id);
    if (job.status === 'pending') {
      return this.store.update(id, { status: 'canceled', error: 'Canceled before it was sent to Higgsfield', finishedAt: nowIso() })!;
    }
    if (job.status === 'queued' && job.requestId && this.api) {
      const result = await this.api.cancel(job.requestId);
      if (result === 'canceled') {
        return this.store.update(id, { status: 'canceled', error: 'Canceled', finishedAt: nowIso() })!;
      }
      await this.poll(job);
    }
    if (job.status === 'queued' || job.status === 'in_progress') {
      throw new HttpProblem(409, 'Generation has already started; Higgsfield can only cancel requests that are still queued');
    }
    if (job.status === 'submitting') throw new HttpProblem(409, 'This job is being submitted right now; try again in a moment');
    throw new HttpProblem(409, 'This job has already finished');
  }

  async refresh(id: string): Promise<Job> {
    const job = this.store.require(id);
    if (job.status === 'queued' || job.status === 'in_progress') await this.poll(job);
    return job;
  }

  remove(id: string): void {
    const job = this.store.require(id);
    if (ACTIVE_STATUSES.includes(job.status)) throw new HttpProblem(409, 'Cancel or wait for this job before deleting it');
    this.store.remove(id);
  }

  /** Submit pending jobs one at a time. */
  private async drain(): Promise<void> {
    if (this.submitting || !this.api) return;
    this.submitting = true;
    try {
      for (let job = this.store.nextPending(); job; job = this.store.nextPending()) {
        this.store.update(job.id, { status: 'submitting' });
        const { endpoint, input } = toHiggsfieldRequest(job.prompt, job.settings, job.media);
        try {
          const accepted = await this.api.submit(endpoint, input);
          const status: JobStatus = accepted.status === 'in_progress' ? 'in_progress' : 'queued';
          this.store.update(job.id, { status, requestId: accepted.requestId, submittedAt: nowIso() });
          console.log(`Submitted job ${job.id} -> request ${accepted.requestId} (${endpoint})`);
        } catch (error) {
          const problem = error instanceof HiggsfieldError ? error : new HiggsfieldError(String(error));
          // No HTTP status means the request may or may not have reached Higgsfield.
          const message =
            problem.httpStatus === undefined
              ? `${problem.message}. It may or may not have reached Higgsfield; check your console before retrying.`
              : problem.message;
          this.store.update(job.id, { status: 'error', error: message, finishedAt: nowIso() });
          console.warn(`Job ${job.id} was not submitted: ${message}`);
          if (problem.httpStatus === 401 || problem.httpStatus === 403) this.failPending(`Not submitted: ${problem.message}`);
        }
      }
    } finally {
      this.submitting = false;
    }
  }

  /** Account-level failures (bad key, no credits) would fail every remaining job the same way. */
  private failPending(reason: string): void {
    for (const job of this.store.all()) {
      if (job.status === 'pending') this.store.update(job.id, { status: 'error', error: reason, finishedAt: nowIso() });
    }
  }

  private async pollActive(): Promise<void> {
    if (this.polling || !this.api) return;
    this.polling = true;
    try {
      for (const job of this.store.all()) {
        if (job.status === 'queued' || job.status === 'in_progress') await this.poll(job);
      }
    } finally {
      this.polling = false;
    }
  }

  private async poll(job: Job): Promise<void> {
    if (!this.api || !job.requestId) return;
    try {
      this.apply(job, await this.api.status(job.requestId));
    } catch (error) {
      if (error instanceof HiggsfieldError && error.httpStatus === 404) {
        this.store.update(job.id, { status: 'error', error: 'Higgsfield no longer knows this request (HTTP 404)', finishedAt: nowIso() });
        return;
      }
      // Anything else (network trouble, 5xx, 429): keep the job active and try again next tick.
    }
    const started = Date.parse(job.submittedAt ?? job.createdAt);
    if ((job.status === 'queued' || job.status === 'in_progress') && Date.now() - started > this.options.maxWaitMs) {
      const minutes = Math.round(this.options.maxWaitMs / 60_000);
      this.store.update(job.id, {
        status: 'error',
        error: `No final status after ${minutes} minutes. It may still finish; check your Higgsfield console.`,
        finishedAt: nowIso(),
      });
    }
  }

  private apply(job: Job, remote: RemoteStatus): void {
    const finishedAt = nowIso();
    switch (remote.status) {
      case 'queued':
      case 'in_progress':
        if (job.status !== remote.status) this.store.update(job.id, { status: remote.status });
        return;
      case 'completed':
        if (remote.videoUrl) this.store.update(job.id, { status: 'completed', videoUrl: remote.videoUrl, error: undefined, finishedAt });
        else this.store.update(job.id, { status: 'error', error: 'Higgsfield reported completion but returned no video URL', finishedAt });
        return;
      case 'failed':
        this.store.update(job.id, { status: 'failed', error: remote.reason ?? 'Generation failed', finishedAt });
        return;
      case 'nsfw':
        this.store.update(job.id, { status: 'nsfw', error: remote.reason ?? 'Rejected by content moderation', finishedAt });
        return;
      case 'canceled':
        this.store.update(job.id, { status: 'canceled', error: remote.reason ?? 'Canceled', finishedAt });
        return;
      default:
      // Unknown state: keep polling.
    }
  }
}
