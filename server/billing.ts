/**
 * Money: admin-editable pricing, the credit ledger, and payments through Stripe Checkout or
 * Razorpay. Amounts are integers in the currency's minor unit (cents/paise). Every balance change
 * goes through `move`, which refuses to go below zero and records a ledger row.
 */
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import axios from 'axios';
import { MODELS, modelById } from '../shared/models.ts';
import { formatMoney } from '../shared/pricing.ts';
import type { CheckoutStart, LedgerEntry, LedgerKind, PaymentRecord, PaymentStatus, Pricing } from '../shared/types.ts';
import type { UserRow } from './auth.ts';
import type { PlatformConfig } from './config.ts';
import { nowIso, type DB } from './db.ts';
import { HttpProblem } from './requests.ts';

interface PaymentRow {
  id: string;
  user_id: string;
  provider: 'stripe' | 'razorpay' | 'manual';
  provider_ref: string | null;
  provider_payment_id: string | null;
  amount_cents: number;
  currency: string;
  status: PaymentStatus;
  created_at: string;
  paid_at: string | null;
}

interface LedgerRow {
  id: number;
  amount_cents: number;
  balance_after_cents: number;
  kind: LedgerKind;
  job_id: string | null;
  payment_id: string | null;
  note: string | null;
  created_at: string;
}

// ---- signatures -----------------------------------------------------------------------------

function hmacMatches(data: Buffer | string, signatureHex: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(data).digest();
  const given = /^[0-9a-f]+$/i.test(signatureHex) ? Buffer.from(signatureHex, 'hex') : Buffer.alloc(0);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Stripe-Signature: `t=<unix>,v1=<hex>[,v1=...]`, HMAC-SHA256 of `${t}.${rawBody}`, within 5 minutes. */
export function verifyStripeSignature(raw: Buffer, header: string, secret: string, nowMs = Date.now()): boolean {
  const pairs = header.split(',').map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()] as const;
  });
  const t = pairs.find(([key]) => key === 't')?.[1];
  const signatures = pairs.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!t || !/^\d+$/.test(t) || signatures.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > 300) return false;
  const signed = Buffer.concat([Buffer.from(`${t}.`), raw]);
  return signatures.some((signature) => hmacMatches(signed, signature, secret));
}

export const verifyRazorpaySignature = (data: Buffer | string, signature: string, secret: string) => hmacMatches(data, signature, secret);

// ---- provider APIs (REST; axios honors proxy settings) --------------------------------------

interface RazorpayPayment {
  id: string;
  order_id: string;
  status: string;
  amount: number;
  currency: string;
}

function providerFailure(provider: string, error: unknown): HttpProblem {
  const status = axios.isAxiosError(error) ? (error.response?.status ?? error.code) : undefined;
  // Log the status only: raw axios errors carry the Authorization header.
  console.error(`${provider} request failed${status === undefined ? '' : ` (${status})`}`);
  return new HttpProblem(502, 'The payment provider did not respond as expected. Please try again.');
}

function stripeApi(secretKey: string, apiBase: string) {
  const http = axios.create({ baseURL: apiBase, timeout: 30_000, headers: { Authorization: `Bearer ${secretKey}` } });
  return {
    async createCheckoutSession(params: Record<string, string>) {
      try {
        const { data } = await http.post('/v1/checkout/sessions', new URLSearchParams(params).toString(), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        return data as { id: string; url: string };
      } catch (error) {
        throw providerFailure('Stripe', error);
      }
    },
    async getCheckoutSession(id: string) {
      try {
        const { data } = await http.get(`/v1/checkout/sessions/${encodeURIComponent(id)}`);
        return data as { id: string; payment_status: string; payment_intent?: string | null; amount_total?: number; currency?: string };
      } catch (error) {
        throw providerFailure('Stripe', error);
      }
    },
  };
}

function razorpayApi(keyId: string, keySecret: string, apiBase: string) {
  const http = axios.create({ baseURL: apiBase, timeout: 30_000, auth: { username: keyId, password: keySecret } });
  const call = async <T>(request: () => Promise<{ data: T }>) => {
    try {
      return (await request()).data;
    } catch (error) {
      throw providerFailure('Razorpay', error);
    }
  };
  return {
    createOrder: (body: { amount: number; currency: string; receipt: string; notes: Record<string, string> }) =>
      call<{ id: string }>(() => http.post('/v1/orders', body)),
    getPayment: (id: string) => call<RazorpayPayment>(() => http.get(`/v1/payments/${encodeURIComponent(id)}`)),
    capture: (id: string, amount: number, currency: string) =>
      call<RazorpayPayment>(() => http.post(`/v1/payments/${encodeURIComponent(id)}/capture`, { amount, currency })),
  };
}

// ---- billing ------------------------------------------------------------------------------

export function createBilling(db: DB, config: PlatformConfig) {
  const getSetting = db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?');
  const putSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const addBalance = db.prepare('UPDATE users SET balance_cents = balance_cents + ? WHERE id = ? AND balance_cents + ? >= 0');
  const balanceOf = db.prepare<[string], { balance_cents: number }>('SELECT balance_cents FROM users WHERE id = ?');
  const insertLedger = db.prepare(
    'INSERT INTO ledger (user_id, amount_cents, balance_after_cents, kind, job_id, payment_id, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const markJobRefunded = db.prepare('UPDATE jobs SET refunded_at = ? WHERE id = ? AND refunded_at IS NULL AND price_cents > 0');
  const insertPayment = db.prepare(
    'INSERT INTO payments (id, user_id, provider, provider_ref, amount_cents, currency, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const setPaymentRef = db.prepare('UPDATE payments SET provider_ref = ? WHERE id = ?');
  const paymentByRef = db.prepare<[string, string], PaymentRow>('SELECT * FROM payments WHERE provider = ? AND provider_ref = ?');
  const paymentById = db.prepare<[string], PaymentRow>('SELECT * FROM payments WHERE id = ?');
  const markPaid = db.prepare(
    "UPDATE payments SET status = 'paid', paid_at = ?, provider_payment_id = COALESCE(?, provider_payment_id) WHERE id = ? AND status = 'pending'",
  );

  const stripe = config.payments.stripe ? stripeApi(config.payments.stripe.secretKey, config.payments.stripe.apiBase) : undefined;
  const razorpay = config.payments.razorpay
    ? razorpayApi(config.payments.razorpay.keyId, config.payments.razorpay.keySecret, config.payments.razorpay.apiBase)
    : undefined;
  const money = (cents: number) => formatMoney(cents, config.currency);

  /** Model defaults, then env overrides, then what the admin saved (older saves priced Seedance 2.5 only). */
  function pricing(): Pricing {
    const saved = getSetting.get('pricing');
    const stored = (saved ? JSON.parse(saved.value) : {}) as Partial<Pricing> & { perSecondCents?: Record<string, number> };
    const storedPerSecond = stored.perSecond ?? (stored.perSecondCents ? { 'seedance-2.5': stored.perSecondCents } : {});
    const perSecond: Pricing['perSecond'] = {};
    for (const model of MODELS) {
      const merged = { ...model.defaultPrices, ...config.defaults.perSecond[model.id], ...storedPerSecond[model.id] };
      // Only this model's qualities, so a renamed quality never lingers.
      perSecond[model.id] = Object.fromEntries(model.qualities.map((q) => [q.id, merged[q.id] ?? 0]));
    }
    return {
      currency: config.currency,
      perSecond,
      disabledModels: (stored.disabledModels ?? []).filter((id) => modelById(id)),
      packsCents: stored.packsCents?.length ? stored.packsCents : config.defaults.packsCents,
      signupBonusCents: stored.signupBonusCents ?? config.defaults.signupBonusCents,
    };
  }

  function updatePricing(input: unknown): Pricing {
    const body = (input ?? {}) as Partial<Pricing>;
    const cents = (value: unknown, what: string, min: number, max: number) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new HttpProblem(400, `${what} must be between ${money(min)} and ${money(max)}`);
      }
      return value;
    };
    const perSecond: Pricing['perSecond'] = {};
    for (const model of MODELS) {
      perSecond[model.id] = Object.fromEntries(
        model.qualities.map((q) => [q.id, cents(body.perSecond?.[model.id]?.[q.id], `${model.name} ${q.label} price per second`, 0, 100_000)]),
      );
    }
    const disabledModels = Array.isArray(body.disabledModels) ? [...new Set(body.disabledModels.filter((id) => typeof id === 'string' && modelById(id)))] : [];
    if (disabledModels.length === MODELS.length) throw new HttpProblem(400, 'Offer at least one model');
    if (!Array.isArray(body.packsCents) || body.packsCents.length === 0 || body.packsCents.length > 8) {
      throw new HttpProblem(400, 'Offer between 1 and 8 credit packs');
    }
    const packsCents = [...new Set(body.packsCents.map((pack) => cents(pack, 'Each credit pack', 100, 10_000_000)))].sort((a, b) => a - b);
    const signupBonusCents = cents(body.signupBonusCents ?? 0, 'Welcome credit', 0, 1_000_000);
    putSetting.run('pricing', JSON.stringify({ perSecond, disabledModels, packsCents, signupBonusCents }));
    return pricing();
  }

  /** Change a balance and record why. Throws 402 (nothing changed) if it would go below zero. */
  function move(
    userId: string,
    amountCents: number,
    kind: LedgerKind,
    refs: { jobId?: string; paymentId?: string; note?: string; actor?: string } = {},
  ) {
    if (addBalance.run(amountCents, userId, amountCents).changes === 0) {
      throw new HttpProblem(402, 'Not enough credit. Buy credit to continue.');
    }
    const balance = balanceOf.get(userId)!.balance_cents;
    insertLedger.run(userId, amountCents, balance, kind, refs.jobId ?? null, refs.paymentId ?? null, refs.note ?? null, refs.actor ?? null, nowIso());
    return balance;
  }

  /** Return a job's charge to its owner, at most once. */
  const refundJob = db.transaction((job: { id: string; user_id: string; price_cents: number }, note: string, actor?: string): boolean => {
    if (markJobRefunded.run(nowIso(), job.id).changes === 0) return false;
    move(job.user_id, job.price_cents, 'refund', { jobId: job.id, note, actor });
    return true;
  });

  /** Credit a payment exactly once, however many times (redirect, webhook) it is confirmed. */
  const settlePayment = db.transaction((paymentId: string, providerPaymentId?: string): boolean => {
    if (markPaid.run(nowIso(), providerPaymentId ?? null, paymentId).changes === 0) return false;
    const payment = paymentById.get(paymentId)!;
    const via = payment.provider === 'stripe' ? 'Stripe' : payment.provider === 'razorpay' ? 'Razorpay' : payment.provider;
    move(payment.user_id, payment.amount_cents, 'purchase', { paymentId, note: `${money(payment.amount_cents)} via ${via}` });
    console.log(`Payment ${paymentId} settled: ${money(payment.amount_cents)} for user ${payment.user_id}`);
    return true;
  });

  function amountsMatch(payment: PaymentRow, amount: unknown, currency: unknown): boolean {
    const ok = amount === payment.amount_cents && String(currency ?? '').toUpperCase() === payment.currency;
    if (!ok) console.error(`Payment ${payment.id}: provider amount/currency does not match; not credited`);
    return ok;
  }

  async function startCheckout(user: UserRow, packCents: number, siteUrl: string): Promise<CheckoutStart> {
    if (!pricing().packsCents.includes(packCents)) throw new HttpProblem(400, 'Choose one of the credit packs');
    const provider = config.payments.provider;
    if (provider === 'manual') {
      throw new HttpProblem(400, config.payments.manualNote ?? 'Online payment is not set up yet. Please contact support to buy credit.');
    }
    const id = randomUUID();
    insertPayment.run(id, user.id, provider, null, packCents, config.currency, 'pending', nowIso());
    const description = `${money(packCents)} of ${config.appName} credit`;

    if (provider === 'stripe' && stripe) {
      const session = await stripe.createCheckoutSession({
        mode: 'payment',
        success_url: `${siteUrl}/app?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${siteUrl}/app?payment=canceled`,
        client_reference_id: id,
        customer_email: user.email,
        'metadata[payment_id]': id,
        'payment_intent_data[metadata][payment_id]': id,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': config.currency.toLowerCase(),
        'line_items[0][price_data][unit_amount]': String(packCents),
        'line_items[0][price_data][product_data][name]': description,
      });
      setPaymentRef.run(session.id, id);
      return { kind: 'redirect', url: session.url };
    }

    if (provider === 'razorpay' && razorpay) {
      const order = await razorpay.createOrder({ amount: packCents, currency: config.currency, receipt: id, notes: { payment_id: id, user_id: user.id } });
      setPaymentRef.run(order.id, id);
      return {
        kind: 'razorpay',
        paymentId: id,
        keyId: config.payments.razorpay!.keyId,
        orderId: order.id,
        amount: packCents,
        currency: config.currency,
        name: config.appName,
        description,
        email: user.email,
      };
    }
    throw new HttpProblem(503, 'Payments are not configured');
  }

  /** After Stripe redirects back: ask Stripe whether the session was paid. */
  async function confirmStripe(user: UserRow, sessionId: string): Promise<PaymentStatus> {
    const payment = paymentByRef.get('stripe', sessionId);
    if (!payment || payment.user_id !== user.id) throw new HttpProblem(404, 'Payment not found');
    if (payment.status !== 'pending' || !stripe) return payment.status;
    const session = await stripe.getCheckoutSession(sessionId);
    if (session.payment_status !== 'paid') return 'pending';
    if (!amountsMatch(payment, session.amount_total, session.currency)) throw new HttpProblem(409, 'Payment amount mismatch; contact support');
    settlePayment(payment.id, typeof session.payment_intent === 'string' ? session.payment_intent : undefined);
    return 'paid';
  }

  /** After the Razorpay popup succeeds: check its signature, capture if needed, then credit. */
  async function confirmRazorpay(user: UserRow, orderId: string, providerPaymentId: string, signature: string): Promise<PaymentStatus> {
    const keys = config.payments.razorpay;
    if (!keys || !razorpay) throw new HttpProblem(503, 'Razorpay is not configured');
    if (!verifyRazorpaySignature(`${orderId}|${providerPaymentId}`, signature, keys.keySecret)) {
      throw new HttpProblem(400, 'Payment verification failed');
    }
    const payment = paymentByRef.get('razorpay', orderId);
    if (!payment || payment.user_id !== user.id) throw new HttpProblem(404, 'Payment not found');
    if (payment.status !== 'pending') return payment.status;
    let remote = await razorpay.getPayment(providerPaymentId);
    if (remote.order_id !== orderId) throw new HttpProblem(400, 'Payment does not belong to this order');
    if (remote.status === 'authorized') remote = await razorpay.capture(providerPaymentId, payment.amount_cents, payment.currency);
    if (remote.status !== 'captured') return 'pending';
    if (!amountsMatch(payment, remote.amount, remote.currency)) throw new HttpProblem(409, 'Payment amount mismatch; contact support');
    settlePayment(payment.id, providerPaymentId);
    return 'paid';
  }

  function stripeWebhook(raw: Buffer, signatureHeader: string | undefined) {
    const secret = config.payments.stripe?.webhookSecret;
    if (!secret) throw new HttpProblem(503, 'STRIPE_WEBHOOK_SECRET is not configured');
    if (!signatureHeader || !verifyStripeSignature(raw, signatureHeader, secret)) throw new HttpProblem(400, 'Invalid signature');
    const event = JSON.parse(raw.toString('utf8'));
    if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') return;
    const session = event.data?.object ?? {};
    if (session.payment_status !== 'paid') return;
    const payment = paymentByRef.get('stripe', String(session.id));
    if (payment && amountsMatch(payment, session.amount_total, session.currency)) {
      settlePayment(payment.id, typeof session.payment_intent === 'string' ? session.payment_intent : undefined);
    }
  }

  function razorpayWebhook(raw: Buffer, signature: string | undefined) {
    const secret = config.payments.razorpay?.webhookSecret;
    if (!secret) throw new HttpProblem(503, 'RAZORPAY_WEBHOOK_SECRET is not configured');
    if (!signature || !verifyRazorpaySignature(raw, signature, secret)) throw new HttpProblem(400, 'Invalid signature');
    const event = JSON.parse(raw.toString('utf8'));
    if (event.event !== 'payment.captured' && event.event !== 'order.paid') return;
    const remote = event.payload?.payment?.entity;
    const orderId = event.payload?.order?.entity?.id ?? remote?.order_id;
    if (!orderId || !remote || remote.status !== 'captured') return;
    const payment = paymentByRef.get('razorpay', String(orderId));
    if (payment && amountsMatch(payment, remote.amount, remote.currency)) settlePayment(payment.id, String(remote.id));
  }

  function ledgerFor(userId: string, limit = 200): LedgerEntry[] {
    return db
      .prepare<[string, number], LedgerRow>('SELECT * FROM ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?')
      .all(userId, limit)
      .map((row) => ({
        id: row.id,
        amountCents: row.amount_cents,
        balanceAfterCents: row.balance_after_cents,
        kind: row.kind,
        jobId: row.job_id ?? undefined,
        paymentId: row.payment_id ?? undefined,
        note: row.note ?? undefined,
        createdAt: row.created_at,
      }));
  }

  function payments(filter: { userId?: string; limit?: number } = {}): PaymentRecord[] {
    const rows = db
      .prepare<[string | null, string | null, number], PaymentRow & { email: string }>(
        `SELECT p.*, u.email FROM payments p JOIN users u ON u.id = p.user_id
         WHERE (? IS NULL OR p.user_id = ?) ORDER BY p.created_at DESC LIMIT ?`,
      )
      .all(filter.userId ?? null, filter.userId ?? null, filter.limit ?? 200);
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userEmail: row.email,
      provider: row.provider,
      amountCents: row.amount_cents,
      currency: row.currency,
      status: row.status,
      createdAt: row.created_at,
      paidAt: row.paid_at ?? undefined,
    }));
  }

  return {
    pricing,
    updatePricing,
    move,
    refundJob,
    settlePayment,
    startCheckout,
    confirmStripe,
    confirmRazorpay,
    stripeWebhook,
    razorpayWebhook,
    ledgerFor,
    payments,
  };
}

export type Billing = ReturnType<typeof createBilling>;
