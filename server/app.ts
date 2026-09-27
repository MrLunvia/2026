/** HTTP API for the video UI. Everything under /api; the UI itself is mounted by main.ts. */
import axios from 'axios';
import express, { type NextFunction, type Request, type Response } from 'express';
import { LIMITS } from '../shared/options.ts';
import type { AppConfig } from '../shared/types.ts';
import { HiggsfieldError, isAcceptableUrl, toHiggsfieldError, type HiggsfieldApi } from './higgsfield.ts';
import type { JobRunner, JobStore } from './jobs.ts';
import { HttpProblem, parseCreateJobs } from './requests.ts';

export interface AppDeps {
  store: JobStore;
  runner: JobRunner;
  api: HiggsfieldApi | undefined;
  /** Host names the server answers to (DNS-rebinding protection for a server that spends credits). */
  allowedHosts: Set<string>;
  environment: AppConfig['environment'];
}

const NOT_CONFIGURED = 'HF_CREDENTIALS is not configured on the server. Add it (in .env.local, or as a Codespaces secret) and restart.';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Identify the real image type from its first bytes rather than trusting the declared type. */
export function sniffImageType(bytes: Buffer): string | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes.length >= 6 && ['GIF87a', 'GIF89a'].includes(bytes.toString('latin1', 0, 6))) return 'image/gif';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

function hostGuard(allowedHosts: Set<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const hostHeader = req.headers.host ?? '';
    const host = hostHeader.replace(/:\d+$/, '').toLowerCase();
    if (!allowedHosts.has(host)) {
      res.status(403).type('text').send('Host not allowed. Set ALLOWED_HOSTS to serve this name.');
      return;
    }
    // Block cross-site writes: browsers send Origin on POST/DELETE. Accept the page's own origin, or a
    // configured public name (a forwarding proxy such as Codespaces may rewrite Host to localhost).
    const origin = req.headers.origin;
    if (origin && req.method !== 'GET' && req.method !== 'HEAD') {
      let trusted = false;
      try {
        const url = new URL(origin);
        const name = url.hostname.toLowerCase();
        trusted = url.host === hostHeader || (!LOOPBACK.has(name) && allowedHosts.has(name));
      } catch {
        trusted = false;
      }
      if (!trusted) {
        res.status(403).json({ error: 'Cross-origin request blocked' });
        return;
      }
    }
    next();
  };
}

export function createApp({ store, runner, api, allowedHosts, environment }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostGuard(allowedHosts));

  const router = express.Router();
  const requireApi = (): HiggsfieldApi => {
    if (!api) throw new HttpProblem(503, NOT_CONFIGURED);
    return api;
  };

  router.get('/config', (_req, res) => {
    const config: AppConfig = { credentialsConfigured: api !== undefined, environment };
    res.json(config);
  });

  router.post(
    '/uploads',
    express.raw({ type: () => true, limit: LIMITS.uploadBytes }),
    async (req, res) => {
      const higgsfield = requireApi();
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (bytes.length === 0) throw new HttpProblem(400, 'Empty upload');
      const type = sniffImageType(bytes);
      if (!type) throw new HttpProblem(415, 'Only JPEG, PNG, WebP and GIF images are supported');
      res.json({ url: await higgsfield.upload(bytes, type) });
    },
  );

  router.get('/jobs', (req, res) => {
    const etag = store.etag;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.json({ jobs: store.list() });
  });

  router.post('/jobs', express.json({ limit: '40mb' }), (req, res) => {
    requireApi();
    const request = parseCreateJobs(req.body);
    const jobs = runner.enqueue(request);
    res.status(201).json({ jobs: jobs.map(({ prompt: _prompt, ...summary }) => summary) });
  });

  router.get('/jobs/:id', (req, res) => {
    res.json(store.require(req.params.id));
  });

  // Same-origin download of a finished video (the browser ignores `download` on cross-origin links).
  router.get('/jobs/:id/download', async (req, res) => {
    const job = store.require(req.params.id);
    if (job.status !== 'completed' || !job.videoUrl || !isAcceptableUrl(job.videoUrl)) throw new HttpProblem(404, 'No video for this job');
    let upstream;
    try {
      // Plain axios: the video host must never receive the Higgsfield credentials.
      upstream = await axios.get<NodeJS.ReadableStream>(job.videoUrl, { responseType: 'stream', timeout: 120_000 });
    } catch (error) {
      throw toHiggsfieldError(error);
    }
    const name = (job.title ?? 'seedance').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'seedance';
    res.setHeader('Content-Type', String(upstream.headers['content-type'] ?? 'video/mp4'));
    if (upstream.headers['content-length']) res.setHeader('Content-Length', String(upstream.headers['content-length']));
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${job.id.slice(0, 8)}.mp4"`);
    upstream.data.on('error', () => res.destroy());
    upstream.data.pipe(res);
  });

  router.post('/jobs/:id/cancel', async (req, res) => {
    const job = await runner.cancel(req.params.id);
    res.json({ status: job.status });
  });

  router.post('/jobs/:id/refresh', async (req, res) => {
    const job = await runner.refresh(req.params.id);
    res.json({ status: job.status });
  });

  router.post('/jobs/:id/retry', (req, res) => {
    requireApi();
    const job = runner.retry(req.params.id);
    res.status(201).json({ id: job.id });
  });

  router.delete('/jobs/:id', (req, res) => {
    runner.remove(req.params.id);
    res.status(204).end();
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Only curated messages reach the browser; unexpected errors are logged by message, never by object.
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpProblem) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof HiggsfieldError) {
      res.status(502).json({ error: error.message });
    } else if (typeof error === 'object' && error !== null && (error as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: 'Request is too large' });
    } else if (typeof error === 'object' && error !== null && (error as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body is not valid JSON' });
    } else {
      console.error(`Unexpected server error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: 'Unexpected server error' });
    }
  });

  app.use('/api', router);
  return app;
}
