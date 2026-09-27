/** Public config, the customer's wallet, and checkout/confirmation for credit packs. */
import type { Router } from 'express';
import type { PublicConfig } from '../../shared/types.ts';
import { rateLimiter } from '../auth.ts';
import { HttpProblem } from '../requests.ts';
import { siteUrl, smallJson, userById, type Deps } from './context.ts';

export function billingRoutes(router: Router, { db, config, auth, billing, mailer, api, environment }: Deps): void {
  const checkoutLimit = rateLimiter(20, 60 * 60_000);

  router.get('/config', (_req, res) => {
    const body: PublicConfig = {
      appName: config.appName,
      supportEmail: config.supportEmail,
      business: config.business,
      pricing: billing.pricing(),
      payments: { provider: config.payments.provider, manualNote: config.payments.manualNote },
      emailEnabled: mailer !== undefined,
      generationEnabled: api !== undefined,
      limits: { maxPromptsPerRequest: config.maxPromptsPerRequest, maxActiveJobs: config.maxActiveJobsPerUser },
      environment,
    };
    res.json(body);
  });

  router.get('/billing', (req, res) => {
    const user = auth.requireUser(req);
    res.json({
      user: auth.publicUser(user),
      ledger: billing.ledgerFor(user.id, 200),
      payments: billing.payments({ userId: user.id, limit: 50 }),
    });
  });

  router.post('/billing/checkout', smallJson, async (req, res) => {
    const user = auth.requireUser(req);
    checkoutLimit(`user:${user.id}`);
    const packCents = Number(req.body?.packCents);
    if (!Number.isInteger(packCents)) throw new HttpProblem(400, 'Choose a credit pack');
    res.json(await billing.startCheckout(user, packCents, siteUrl(config, req)));
  });

  router.post('/billing/stripe/confirm', smallJson, async (req, res) => {
    const user = auth.requireUser(req);
    const status = await billing.confirmStripe(user, String(req.body?.sessionId ?? ''));
    res.json({ status, user: auth.publicUser(userById(db, user.id)!) });
  });

  router.post('/billing/razorpay/confirm', smallJson, async (req, res) => {
    const user = auth.requireUser(req);
    const { orderId, paymentId, signature } = req.body ?? {};
    const status = await billing.confirmRazorpay(user, String(orderId ?? ''), String(paymentId ?? ''), String(signature ?? ''));
    res.json({ status, user: auth.publicUser(userById(db, user.id)!) });
  });
}
