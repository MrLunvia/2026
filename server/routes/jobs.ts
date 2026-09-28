/** A customer's uploads and videos. Every route acts on the logged-in customer's own data. */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import express, { type Router } from 'express';
import { LIMITS } from '../../shared/options.ts';
import type { UploadResult } from '../../shared/types.ts';
import { rateLimiter } from '../auth.ts';
import { nowIso } from '../db.ts';
import { isAcceptableUrl, toHiggsfieldError, type HiggsfieldApi } from '../higgsfield.ts';
import type { JobRow } from '../jobs.ts';
import { isUnsupportedVideo, mp4Duration, readHead, saveBody, sniffMedia } from '../media.ts';
import { HttpProblem, parseCreateJobs } from '../requests.ts';
import { smallJson, userById, type Deps } from './context.ts';

const SIZE_LIMIT = { image: LIMITS.imageBytes, video: LIMITS.videoBytes, audio: LIMITS.audioBytes } as const;
const megabytes = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

function whole(body: unknown, key: string): number | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[key];
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

  // Streams to a temporary file (videos can be large), checks what the file really is, measures videos
  // so their seconds can be priced, then hands it to Higgsfield storage and remembers it for this customer.
  router.post('/uploads', async (req, res) => {
    const user = auth.requireUser(req);
    uploadLimit(`user:${user.id}`, 'Too many uploads. Please wait a while and try again.');
    const higgsfield = requireApi();
    if (Number(req.headers['content-length']) > LIMITS.videoBytes) throw new HttpProblem(413, `Files can be up to ${megabytes(LIMITS.videoBytes)}`);
    const file = path.join(os.tmpdir(), `upload-${randomUUID()}`);
    try {
      const size = await saveBody(req, file, LIMITS.videoBytes);
      if (size === 0) throw new HttpProblem(400, 'Empty upload');
      const head = await readHead(file);
      const type = sniffMedia(head);
      if (!type) {
        throw new HttpProblem(415, isUnsupportedVideo(head) ? 'Upload videos as MP4 or MOV.' : 'Use a JPEG, PNG, WebP or GIF image, an MP4 or MOV video, or an MP3, WAV, M4A or AAC audio file.');
      }
      if (size > SIZE_LIMIT[type.kind]) throw new HttpProblem(413, `${type.kind === 'image' ? 'Images' : type.kind === 'video' ? 'Videos' : 'Audio files'} can be up to ${megabytes(SIZE_LIMIT[type.kind])}`);
      let seconds: number | undefined;
      if (type.kind === 'video' || type.contentType === 'audio/mp4') seconds = await mp4Duration(file);
      if (type.kind === 'video') {
        if (seconds === undefined) throw new HttpProblem(415, 'Couldn’t read this video’s length. Upload an MP4 or MOV file.');
        if (seconds > LIMITS.videoSeconds) throw new HttpProblem(400, `Videos can be up to ${LIMITS.videoSeconds} seconds; trim it first.`);
      }
      const url = await higgsfield.upload(file, type.contentType, size);
      db.prepare('INSERT OR REPLACE INTO uploads (url, user_id, kind, content_type, bytes, seconds, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        url, user.id, type.kind, type.contentType, size, seconds ?? null, nowIso(),
      );
      const result: UploadResult = { url, kind: type.kind, contentType: type.contentType, ...(seconds !== undefined ? { seconds } : {}) };
      res.json(result);
    } finally {
      await fs.rm(file, { force: true });
    }
  });

  // Public: the videos the owner picked for the home page.
  router.get('/showcase', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ items: store.showcase() });
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
    const jobs = runner.enqueue(user.id, request, { totalCents: whole(req.body, 'expectedTotalCents'), perVideoCents: whole(req.body, 'expectedPriceCents') });
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
    const job = runner.retry(req.params.id, user.id, whole(req.body, 'expectedPriceCents'));
    res.status(201).json({ id: job.id, user: balance(user.id) });
  });

  router.delete('/jobs/:id', (req, res) => {
    const user = auth.requireUser(req);
    runner.remove(req.params.id, user.id);
    res.status(204).end();
  });
}
