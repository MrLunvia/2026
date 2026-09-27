/**
 * Starts the video UI server: `npm run dev` (Vite dev middleware with hot reload) or
 * `npm start` (serves the production build from dist/). Credentials stay on this server.
 */
import http from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config as loadEnv } from 'dotenv';
import { createApp } from './app.ts';
import { createHiggsfieldApi } from './higgsfield.ts';
import { JobRunner, JobStore } from './jobs.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
// Values already set in the environment take precedence over .env.local.
loadEnv({ path: path.join(root, '.env.local'), quiet: true });

const production = process.argv.includes('--production');
const port = Number(process.env.PORT) || 3000;
// Local-only by default: anyone who can reach this server can spend your credits.
const host = process.env.HOST?.trim() || '127.0.0.1';
const baseUrl = (process.env.HF_BASE_URL?.trim() || 'https://api.higgsfield.ai').replace(/\/+$/, '');

const credentials = process.env.HF_CREDENTIALS?.trim();
const credentialsValid = !!credentials && /^[^:\s]+:[^:\s]+$/.test(credentials);
if (!credentials) {
  console.warn('HF_CREDENTIALS is not set: the UI runs, but generation and uploads are disabled. Add it to .env.local and restart.');
} else if (!credentialsValid) {
  console.warn('HF_CREDENTIALS is not in "key-id:key-secret" format: generation and uploads are disabled.');
}

const dataDir = process.env.DATA_DIR?.trim() ? path.resolve(process.env.DATA_DIR.trim()) : path.join(root, 'data');
const store = new JobStore(path.join(dataDir, 'jobs.json'));
await store.load();
const api = credentialsValid ? createHiggsfieldApi({ credentials: credentials!, baseUrl }) : undefined;
const runner = new JobRunner(store, api, { pollIntervalMs: 4_000, maxWaitMs: 60 * 60_000 });
runner.start();

const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
for (const name of (process.env.ALLOWED_HOSTS ?? '').split(',')) {
  if (name.trim()) allowedHosts.add(name.trim().toLowerCase());
}
if (host !== '0.0.0.0' && host !== '::') allowedHosts.add(host.toLowerCase());

const app = createApp({ store, runner, api, allowedHosts });
const server = http.createServer(app);

if (production) {
  const dist = path.join(root, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error('No production build found. Run `npm run build` first, or use `npm run dev`.');
    process.exit(1);
  }
  app.use(express.static(dist));
  app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: path.join(root, 'vite.config.ts'),
    server: { middlewareMode: true, hmr: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

server.listen(port, host, () => {
  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  console.log(`Adron Video Engine running at http://${shown}:${port} (${production ? 'production' : 'development'})`);
});

async function shutdown() {
  runner.stop();
  server.close();
  await store.flush();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
