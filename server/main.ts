/**
 * Starts the platform: `npm run dev` (Vite dev middleware with hot reload) or `npm start`
 * (serves the production build from dist/). All secrets stay on this server.
 */
import http from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config as loadEnv } from 'dotenv';
import { createApp } from './app.ts';
import { createAuth } from './auth.ts';
import { createBilling } from './billing.ts';
import { loadConfig } from './config.ts';
import { openDatabase } from './db.ts';
import { createHiggsfieldApi } from './higgsfield.ts';
import { JobRunner, JobStore } from './jobs.ts';
import { createMailer } from './mailer.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
// Values already set in the environment take precedence over .env.local.
loadEnv({ path: path.join(root, '.env.local'), quiet: true });

const production = process.argv.includes('--production');
const port = Number(process.env.PORT) || 3000;
// Local-only unless HOST is set (e.g. HOST=0.0.0.0 behind a reverse proxy in production).
const host = process.env.HOST?.trim() || '127.0.0.1';
const baseUrl = (process.env.HF_BASE_URL?.trim() || 'https://api.higgsfield.ai').replace(/\/+$/, '');
const config = loadConfig(process.env, root);

// GitHub Codespaces forwards the port at https://<codespace>-<port>.<domain> (private to the owner by default).
const codespace = process.env.CODESPACE_NAME?.trim();
const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN?.trim();
const codespacesUrl = codespace && forwardingDomain ? `https://${codespace}-${port}.${forwardingDomain}` : undefined;

const credentials = process.env.HF_CREDENTIALS?.trim();
const credentialsValid = !!credentials && /^[^:\s]+:[^:\s]+$/.test(credentials);
if (!credentials) {
  console.warn(
    codespacesUrl
      ? 'HF_CREDENTIALS is not set: add it as a Codespaces secret (GitHub > Settings > Codespaces), then restart the codespace.'
      : 'HF_CREDENTIALS is not set: the site runs, but video generation and uploads are disabled. Add it to .env.local (or .env for Docker) and restart.',
  );
} else if (!credentialsValid) {
  console.warn('HF_CREDENTIALS is not in "key-id:key-secret" format: video generation and uploads are disabled.');
}
if (config.adminEmails.size === 0) console.warn('ADMIN_EMAILS is empty: nobody can open the admin dashboard.');
if (production && !config.publicUrl) console.warn('PUBLIC_URL is not set: payment redirects and email links will use the request address.');
console.log(`Payments: ${config.payments.provider}`);
if (config.payments.provider === 'stripe' && !config.payments.stripe?.webhookSecret) {
  console.warn('STRIPE_WEBHOOK_SECRET is not set: payments are confirmed only when customers return to the site.');
}
if (config.payments.provider === 'razorpay' && !config.payments.razorpay?.webhookSecret) {
  console.warn('RAZORPAY_WEBHOOK_SECRET is not set: payments are confirmed only in the customer\'s browser session.');
}

const db = openDatabase(path.join(config.dataDir, 'platform.db'));
const auth = createAuth(db, { adminEmails: config.adminEmails, secureCookies: config.publicUrl?.startsWith('https://') ?? false });
const billing = createBilling(db, config);
const mailer = createMailer(config.smtp);
const api = credentialsValid ? createHiggsfieldApi({ credentials: credentials!, baseUrl }) : undefined;
const store = new JobStore(db);
const runner = new JobRunner(db, store, billing, api, {
  pollIntervalMs: 4_000,
  maxWaitMs: 60 * 60_000,
  maxPendingMs: 60 * 60_000,
  submitConcurrency: 3,
  pollConcurrency: 5,
  maxActivePerUser: config.maxActiveJobsPerUser,
});
runner.start();
setInterval(() => auth.purgeExpired(), 6 * 60 * 60_000).unref();

const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
for (const name of (process.env.ALLOWED_HOSTS ?? '').split(',')) {
  if (name.trim()) allowedHosts.add(name.trim().toLowerCase());
}
if (host !== '0.0.0.0' && host !== '::') allowedHosts.add(host.toLowerCase());
if (codespacesUrl) allowedHosts.add(new URL(codespacesUrl).hostname);
if (config.publicUrl) allowedHosts.add(new URL(config.publicUrl).hostname.toLowerCase());

const app = createApp({
  db,
  config,
  auth,
  billing,
  store,
  runner,
  api,
  mailer,
  allowedHosts,
  environment: codespacesUrl ? 'codespaces' : 'local',
  production,
});
const server = http.createServer(app);

if (production) {
  const dist = path.join(root, 'dist');
  if (!existsSync(path.join(dist, 'index.html'))) {
    console.error('No production build found. Run `npm run build` first, or use `npm run dev`.');
    process.exit(1);
  }
  app.use(
    express.static(dist, {
      index: false,
      // Built files have content hashes in their names, so browsers can keep them for good.
      setHeaders: (res, file) => res.setHeader('Cache-Control', file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'),
    }),
  );
  // Every page route serves the app; the browser picks the page from the URL.
  app.use((req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? res.sendFile(path.join(dist, 'index.html')) : next()));
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
  const url = config.publicUrl ?? codespacesUrl ?? `http://${shown}:${port}`;
  console.log(`${config.appName} running at ${url} (${production ? 'production' : 'development'})`);
});

function shutdown() {
  runner.stop();
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
