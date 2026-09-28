/** Platform settings from the environment (or .env.local). Secrets stay in this process. */
import path from 'node:path';
import type { PaymentProviderName } from '../shared/types.ts';

export interface PlatformConfig {
  appName: string;
  /** Accent color for buttons and highlights (#rrggbb), when the owner sets BRAND_COLOR. */
  brandColor?: string;
  /** Public address, e.g. https://video.adronstore.in; used for payment redirects and email links. */
  publicUrl?: string;
  supportEmail?: string;
  /** Shown on the contact and policy pages (payment providers check these). */
  business: { name?: string; address?: string; phone?: string };
  adminEmails: Set<string>;
  currency: string;
  defaults: {
    /** Env overrides of model prices (PRICE_PER_SECOND_480P/720P set Seedance 2.5's). */
    perSecond: Record<string, Record<string, number>>;
    packsCents: number[];
    signupBonusCents: number;
  };
  payments: {
    provider: PaymentProviderName;
    manualNote?: string;
    stripe?: { secretKey: string; webhookSecret?: string; apiBase: string };
    razorpay?: { keyId: string; keySecret: string; webhookSecret?: string; apiBase: string };
  };
  smtp?: { url: string; from: string };
  maxActiveJobsPerUser: number;
  maxPromptsPerRequest: number;
  trustProxy: boolean;
  dataDir: string;
}

function money(value: string | undefined, fallbackCents: number): number {
  if (value === undefined || value.trim() === '') return fallbackCents;
  const units = Number(value);
  if (!Number.isFinite(units) || units < 0) throw new Error(`Invalid amount: ${value}`);
  return Math.round(units * 100);
}

/** A #rgb or #rrggbb color, expanded to #rrggbb. */
function hexColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) throw new Error(`BRAND_COLOR must be a hex color like #c8ff3d, not ${value}`);
  const hex = match[1]!.toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex}`;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv, root: string): PlatformConfig {
  const trimmed = (key: string) => env[key]?.trim() || undefined;
  const publicUrl = trimmed('PUBLIC_URL')?.replace(/\/+$/, '');
  if (publicUrl && !/^https?:\/\//.test(publicUrl)) throw new Error('PUBLIC_URL must start with https:// (or http:// for local testing)');

  const stripe = trimmed('STRIPE_SECRET_KEY')
    ? {
        secretKey: trimmed('STRIPE_SECRET_KEY')!,
        webhookSecret: trimmed('STRIPE_WEBHOOK_SECRET'),
        apiBase: trimmed('STRIPE_API_BASE') ?? 'https://api.stripe.com',
      }
    : undefined;
  const razorpay =
    trimmed('RAZORPAY_KEY_ID') && trimmed('RAZORPAY_KEY_SECRET')
      ? {
          keyId: trimmed('RAZORPAY_KEY_ID')!,
          keySecret: trimmed('RAZORPAY_KEY_SECRET')!,
          webhookSecret: trimmed('RAZORPAY_WEBHOOK_SECRET'),
          apiBase: trimmed('RAZORPAY_API_BASE') ?? 'https://api.razorpay.com',
        }
      : undefined;

  const requested = trimmed('PAYMENT_PROVIDER') as PaymentProviderName | undefined;
  if (requested && !['stripe', 'razorpay', 'manual'].includes(requested)) throw new Error('PAYMENT_PROVIDER must be stripe, razorpay or manual');
  const provider: PaymentProviderName = requested ?? (stripe ? 'stripe' : razorpay ? 'razorpay' : 'manual');
  if (provider === 'stripe' && !stripe) throw new Error('PAYMENT_PROVIDER=stripe needs STRIPE_SECRET_KEY');
  if (provider === 'razorpay' && !razorpay) throw new Error('PAYMENT_PROVIDER=razorpay needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');

  const packs = (trimmed('CREDIT_PACKS') ?? '12,36,60,120')
    .split(',')
    .map((part) => money(part, 0))
    .filter((cents) => cents > 0);

  const appName = trimmed('APP_NAME') ?? 'Adron Video Engine';
  const supportEmail = trimmed('SUPPORT_EMAIL');
  // Emails come from MAIL_FROM, else the support address, else no-reply@ the site's own domain.
  const sender = supportEmail ?? `no-reply@${publicUrl ? new URL(publicUrl).hostname : 'localhost'}`;

  return {
    appName,
    brandColor: hexColor(trimmed('BRAND_COLOR')),
    publicUrl,
    supportEmail,
    business: { name: trimmed('BUSINESS_NAME'), address: trimmed('BUSINESS_ADDRESS'), phone: trimmed('SUPPORT_PHONE') },
    adminEmails: new Set(
      (env.ADMIN_EMAILS ?? '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
    currency: (trimmed('CURRENCY') ?? 'USD').toUpperCase(),
    defaults: {
      // Seedance 2.5 at 0.40/second makes a 30-second 720p video 12.00.
      perSecond: { 'seedance-2.5': { '480p': money(env.PRICE_PER_SECOND_480P, 30), '720p': money(env.PRICE_PER_SECOND_720P, 40) } },
      packsCents: packs.length > 0 ? packs : [1200],
      signupBonusCents: money(env.SIGNUP_BONUS, 0),
    },
    payments: { provider, manualNote: trimmed('MANUAL_PAYMENT_NOTE'), stripe, razorpay },
    smtp: trimmed('SMTP_URL') ? { url: trimmed('SMTP_URL')!, from: trimmed('MAIL_FROM') ?? `${appName} <${sender}>` } : undefined,
    maxActiveJobsPerUser: positiveInt(env.MAX_ACTIVE_JOBS_PER_USER, 20),
    maxPromptsPerRequest: positiveInt(env.MAX_PROMPTS_PER_REQUEST, 100),
    trustProxy: ['1', 'true', 'yes'].includes((env.TRUST_PROXY ?? '').toLowerCase()),
    dataDir: trimmed('DATA_DIR') ? path.resolve(trimmed('DATA_DIR')!) : path.join(root, 'data'),
  };
}
