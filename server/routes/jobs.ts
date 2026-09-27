/** A customer's image uploads and videos. Every route acts on the logged-in customer's own data. */
import axios from 'axios';
import express, { type Router } from 'express';
import { LIMITS } from '../../shared/options.ts';
import { rateLimiter } from '../auth.ts';
import { isAcceptableUrl, toHiggsfieldError, type HiggsfieldApi } from '../higgsfield.ts';
import type { JobRow } from '../jobs.ts';
import { HttpProblem, parseCreateJobs } from '../requests.ts';
import { smallJson, userById, type Deps } from './context.ts';

/** Identify the real image type from its first bytes rather than trusting the declared type. */
export function sniffImageType(bytes: Buffer): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('latin1', 0, 6))) return 'image/gif';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

function expectedPrice(body: unknown): number | undefined {
  const value = (body as { expectedPriceCents?: unknown } | undefined)?.expectedPriceCents;
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

export function jobRoutes(router: Router, { db, config, auth, store, runner, api }: Deps): void {
  const uploadLimit = rateLimiter(120, 60 * 60_000);
  const createLimit = rateLimiter(60, 60 * 60_000);
  const requireApi = (): HiggsfieldApi => {
    if (!api) throw new HttpProblem(503, 'Video generation is not available right now.');
    return api;
  };
  const balance = (userId: string) => auth.publicUser(userById(db, userId)!);

  router.post('/uploads', express.raw({ type: () => true, limit: LIMITS.uploadBytes }), async (req, res) => {
    const user = auth.requireUser(req);
    uploadLimit(`user:${user.id}`, 'Too many uploads. Please wait a while and try again.');
    const higgsfield = requireApi();
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0) throw new HttpProblem(400, 'Empty upload');
    const type = sniffImageType(bytes);
    if (!type) throw new HttpProblem(415, 'Only JPEG, PNG, WebP and GIF images are supported');
    res.json({ url: await higgsfield.upload(bytes, type) });
  });

  router.get('/jobs', (req, res) => {
    const user = auth.requireUser(req);
    const etag = store.etag(user.id);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.json({ jobs: store.list(user.id) });
  });

  router.post('/jobs', express.json({ limit: '40mb' }), (req, res) => {
    const user = auth.requireUser(req);
    createLimit(`user:${user.id}`, 'Too many requests. Please wait a while and try again.');
    const request = parseCreateJobs(req.body);
    if (request.prompts.length > config.maxPromptsPerRequest) {
      throw new HttpProblem(400, `At most ${config.maxPromptsPerRequest} videos per request`);
    }
    const jobs = runner.enqueue(user.id, request, expectedPrice(req.body));
    res.status(201).json({ jobs: jobs.map(({ prompt: _prompt, ...summary }) => summary), user: balance(user.id) });
  });

  router.get('/jobs/:id', (req, res) => {
    const user = auth.requireUser(req);
    res.json(store.full(store.owned(req.params.id, user.id)));
  });

  // Same-origin download of a finished video (browsers ignore `download` on cross-origin links).
  router.get('/jobs/:id/download', async (req, res) => {
    const user = auth.requireUser(req);
    const row: JobRow = store.owned(req.params.id, user.id);
    if (row.status !== 'completed' || !row.video_url || !isAcceptableUrl(row.video_url)) throw new HttpProblem(404, 'No video for this job');
    let upstream;
    try {
      // Plain axios: the video host must never receive the Higgsfield credentials.
      upstream = await axios.get<NodeJS.ReadableStream>(row.video_url, { responseType: 'stream', timeout: 120_000 });
    } catch (error) {
      throw toHiggsfieldError(error);
    }
    const name = (row.title ?? 'video').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'video';
    res.setHeader('Content-Type', String(upstream.headers['content-type'] ?? 'video/mp4'));
    if (upstream.headers['content-length']) res.setHeader('Content-Length', String(upstream.headers['content-length']));
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${row.id.slice(0, 8)}.mp4"`);
    upstream.data.on('error', () => res.destroy());
    upstream.data.pipe(res);
  });

  router.post('/jobs/:id/cancel', async (req, res) => {
    const user = auth.requireUser(req);
    const row = await runner.cancel(req.params.id, user.id);
    res.json({ status: row.status, user: balance(user.id) });
  });

  router.post('/jobs/:id/refresh', async (req, res) => {
    const user = auth.requireUser(req);
    const row = await runner.refresh(req.params.id, user.id);
    res.json({ status: row.status });
  });

  router.post('/jobs/:id/retry', smallJson, (req, res) => {
    const user = auth.requireUser(req);
    createLimit(`user:${user.id}`, 'Too many requests. Please wait a while and try again.');
    const job = runner.retry(req.params.id, user.id, expectedPrice(req.body));
    res.status(201).json({ id: job.id, user: balance(user.id) });
  });

  router.delete('/jobs/:id', (req, res) => {
    const user = auth.requireUser(req);
    runner.remove(req.params.id, user.id);
    res.status(204).end();
  });
}
