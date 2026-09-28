import type { InputType, MediaKind } from './models.ts';

/** One batch's output choices; which options apply depends on the model (see models.ts). */
export interface GenerationSettings {
  /** A model id from models.ts, e.g. "seedance-2.5". */
  model: string;
  /** A quality id of that model, e.g. "720p" or "pro". */
  quality: string;
  duration: number;
  /** A ratio like "16:9", or "auto". */
  aspectRatio: string;
  generateAudio: boolean;
}

export interface MediaInput {
  mode: InputType;
  startImageUrl?: string;
  endImageUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  /** The video to edit, extend or take motion from. */
  sourceVideoUrl?: string;
  /** An optional audio track (models that take one). */
  soundtrackUrl?: string;
  /** Lengths the server measured when the videos were uploaded (it ignores values sent by the page). */
  sourceVideoSeconds?: number;
  referenceVideoSeconds?: number[];
}

/** What the upload endpoint returns. */
export interface UploadResult {
  url: string;
  kind: MediaKind;
  contentType: string;
  /** Video (and some audio) length in seconds, when it could be read. */
  seconds?: number;
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
  /** Shown on the home page (the owner's own videos only). */
  featured?: boolean;
}

export interface Job extends JobSummary {
  prompt: string;
}

/** A video on the public home page. */
export interface ShowcaseItem {
  id: string;
  videoUrl: string;
  title?: string;
  promptPreview: string;
  model: string;
  quality: string;
  aspectRatio: string;
  duration: number;
}

export type PaymentProviderName = 'stripe' | 'razorpay' | 'manual';

/** Prices in the platform currency's minor unit (cents/paise). */
export interface Pricing {
  currency: string;
  /** Price per billed second, by model id, then quality id. */
  perSecond: Record<string, Record<string, number>>;
  /** Models not offered to customers. */
  disabledModels: string[];
  packsCents: number[];
  signupBonusCents: number;
}

/** Public, non-secret settings the pages need. */
export interface PublicConfig {
  appName: string;
  /** The owner's accent color (#rrggbb), if set. */
  brandColor?: string;
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
