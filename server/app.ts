/** HTTP API under /api. The pages themselves are mounted by main.ts. */
import express, { type NextFunction, type Request, type Response } from 'express';
import { HiggsfieldError } from './higgsfield.ts';
import { HttpProblem } from './requests.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { billingRoutes } from './routes/billing.ts';
import type { Deps } from './routes/context.ts';
import { jobRoutes } from './routes/jobs.ts';

export type { Deps } from './routes/context.ts';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostGuard(allowedHosts: Set<string>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const hostHeader = req.headers.host ?? '';
    const host = hostHeader.replace(/:\d+$/, '').toLowerCase();
    if (!allowedHosts.has(host)) {
      res.status(403).type('text').send('Host not allowed. Set PUBLIC_URL or ALLOWED_HOSTS to serve this name.');
      return;
    }
    // Block cross-site writes: browsers send Origin on POST/PUT/DELETE. Accept the page's own origin, or a
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

function securityHeaders(https: boolean) {
  // Without HTTPS this is a local trial run, possibly against local test services; allow their media too.
  const local = https ? '' : ' http://127.0.0.1:* http://localhost:*';
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src 'self' data: blob: https:${local}`,
    `media-src 'self' blob: https:${local}`,
    "connect-src 'self' https://*.razorpay.com",
    'frame-src https://*.razorpay.com',
    "form-action 'self' https://checkout.stripe.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.razorpay.com")');
    if (https) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

export function createApp(deps: Deps) {
  const app = express();
  app.disable('x-powered-by');
  if (deps.config.trustProxy) app.set('trust proxy', 1);
  app.use(hostGuard(deps.allowedHosts));
  if (deps.production) app.use(securityHeaders(deps.config.publicUrl?.startsWith('https://') ?? false));

  const router = express.Router();

  // Payment providers call these directly; they are verified by signature, not by session.
  const raw = express.raw({ type: () => true, limit: '1mb' });
  router.post('/webhooks/stripe', raw, (req, res) => {
    deps.billing.stripeWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers['stripe-signature'] as string | undefined);
    res.json({ received: true });
  });
  router.post('/webhooks/razorpay', raw, (req, res) => {
    deps.billing.razorpayWebhook(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.headers['x-razorpay-signature'] as string | undefined);
    res.json({ received: true });
  });

  router.use(deps.auth.loadUser);
  billingRoutes(router, deps);
  authRoutes(router, deps);
  jobRoutes(router, deps);
  adminRoutes(router, deps);

  router.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Only curated messages reach the browser; unexpected errors are logged by message, never by object.
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const type = typeof error === 'object' && error !== null ? (error as { type?: string }).type : undefined;
    if (error instanceof HttpProblem) {
      res.status(error.status).json({ error: error.message });
    } else if (error instanceof HiggsfieldError) {
      // Details (which may concern the platform's own Higgsfield account) stay in the server log.
      console.error(`Video service error: ${error.message}`);
      res.status(502).json({ error: 'The video service had a problem. Please try again in a moment.' });
    } else if (type === 'entity.too.large') {
      res.status(413).json({ error: 'Request is too large' });
    } else if (type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Request body is not valid JSON' });
    } else {
      console.error(`Unexpected server error: ${error instanceof Error ? error.message : String(error)}`);
      res.status(500).json({ error: 'Unexpected server error' });
    }
  });

  app.use('/api', router);
  return app;
}
