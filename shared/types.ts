import type { AspectRatio, MediaMode, Resolution } from './options.ts';

export interface GenerationSettings {
  duration: number;
  resolution: Resolution;
  aspectRatio: AspectRatio;
  generateAudio: boolean;
}

export interface MediaInput {
  mode: MediaMode;
  startImageUrl?: string;
  endImageUrl?: string;
  referenceImageUrls?: string[];
}

export interface PromptInput {
  title?: string;
  prompt: string;
  media: MediaInput;
}

export interface CreateJobsRequest {
  settings: GenerationSettings;
  prompts: PromptInput[];
}

/**
 * `pending` and `submitting` are local (nothing billed yet); `queued` through `canceled` are
 * Higgsfield's request states; `error` means the request never started or its outcome is unknown.
 */
export type JobStatus =
  | 'pending'
  | 'submitting'
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'nsfw'
  | 'canceled'
  | 'error';

export const ACTIVE_STATUSES: readonly JobStatus[] = ['pending', 'submitting', 'queued', 'in_progress'];

export interface JobSummary {
  id: string;
  batchId: string;
  batchIndex: number;
  batchSize: number;
  title?: string;
  promptPreview: string;
  wordCount: number;
  settings: GenerationSettings;
  media: MediaInput;
  endpoint: string;
  status: JobStatus;
  requestId?: string;
  videoUrl?: string;
  error?: string;
  /** What the customer was charged for this video. */
  priceCents: number;
  /** Set when the charge went back to the customer's balance. */
  refunded: boolean;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  finishedAt?: string;
}

export interface Job extends JobSummary {
  prompt: string;
}

export type PaymentProviderName = 'stripe' | 'razorpay' | 'manual';

/** Prices in the platform currency's minor unit (cents/paise). */
export interface Pricing {
  currency: string;
  perSecondCents: Record<Resolution, number>;
  packsCents: number[];
  signupBonusCents: number;
}

/** Public, non-secret settings the pages need. */
export interface PublicConfig {
  appName: string;
  supportEmail?: string;
  business: { name?: string; address?: string; phone?: string };
  pricing: Pricing;
  payments: { provider: PaymentProviderName; manualNote?: string };
  emailEnabled: boolean;
  /** Whether the server has a Higgsfield key (generation and uploads work). */
  generationEnabled: boolean;
  limits: { maxPromptsPerRequest: number; maxActiveJobs: number };
  environment: 'local' | 'codespaces';
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  balanceCents: number;
  isAdmin: boolean;
  createdAt: string;
}

export type LedgerKind = 'purchase' | 'generation' | 'refund' | 'adjustment' | 'bonus';

export interface LedgerEntry {
  id: number;
  amountCents: number;
  balanceAfterCents: number;
  kind: LedgerKind;
  jobId?: string;
  paymentId?: string;
  note?: string;
  createdAt: string;
}

export type PaymentStatus = 'pending' | 'paid' | 'failed';

export interface PaymentRecord {
  id: string;
  userId: string;
  userEmail?: string;
  provider: PaymentProviderName;
  amountCents: number;
  currency: string;
  status: PaymentStatus;
  createdAt: string;
  paidAt?: string;
}

export type CheckoutStart =
  | { kind: 'redirect'; url: string }
  | {
      kind: 'razorpay';
      paymentId: string;
      keyId: string;
      orderId: string;
      amount: number;
      currency: string;
      name: string;
      description: string;
      email: string;
    };

export interface AdminOverview {
  service: ServiceStatus;
  users: number;
  payingUsers: number;
  revenueCents: number;
  revenue7dCents: number;
  outstandingCents: number;
  videosCompleted: number;
  videosCompleted7d: number;
  videosActive: number;
  videosRefunded: number;
}

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  balanceCents: number;
  spentCents: number;
  videos: number;
  disabled: boolean;
  isAdmin: boolean;
  createdAt: string;
}

export interface AdminJobRow extends JobSummary {
  userId: string;
  userEmail: string;
  /** Technical reason behind a failure (never shown to customers). */
  detail?: string;
}

export interface ServiceStatus {
  /** Submissions are on hold, e.g. the Higgsfield key was rejected or its credit ran out. */
  paused: boolean;
  reason?: string;
  until?: string;
}
