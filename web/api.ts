/** Browser-side calls to this site's server. Payment and Higgsfield keys never reach the browser. */
import type {
  AdminJobRow,
  AdminOverview,
  AdminUserRow,
  CheckoutStart,
  CreateJobsRequest,
  Job,
  JobSummary,
  LedgerEntry,
  PaymentRecord,
  PaymentStatus,
  Pricing,
  PublicConfig,
  PublicUser,
  UploadResult,
} from '../shared/types.ts';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | undefined;
/** Called when the server says the session is gone (expired, logged out elsewhere, disabled). */
export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  if (!response.ok) {
    let message = `Request failed (HTTP ${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.error === 'string') message = body.error;
    } catch {
      // Non-JSON error body: keep the generic message.
    }
    if (response.status === 401 && !path.startsWith('/auth/')) onUnauthorized?.();
    throw new ApiError(message, response.status);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});
const enc = encodeURIComponent;

export const api = {
  config: () => request<PublicConfig>('/config'),

  // accounts
  me: async () => (await request<{ user: PublicUser | null }>('/auth/me')).user,
  signup: async (body: { name: string; email: string; password: string; acceptTerms: boolean }) =>
    (await request<{ user: PublicUser }>('/auth/signup', json('POST', body))).user,
  login: async (email: string, password: string) => (await request<{ user: PublicUser }>('/auth/login', json('POST', { email, password }))).user,
  logout: () => request<void>('/auth/logout', { method: 'POST' }),
  forgot: (email: string) => request<{ ok: true }>('/auth/forgot', json('POST', { email })),
  reset: async (token: string, password: string) => (await request<{ user: PublicUser }>('/auth/reset', json('POST', { token, password }))).user,
  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>('/auth/password', json('POST', { currentPassword, newPassword })),

  // wallet and payments
  billing: () => request<{ user: PublicUser; ledger: LedgerEntry[]; payments: PaymentRecord[] }>('/billing'),
  checkout: (packCents: number) => request<CheckoutStart>('/billing/checkout', json('POST', { packCents })),
  confirmStripe: (sessionId: string) => request<{ status: PaymentStatus; user: PublicUser }>('/billing/stripe/confirm', json('POST', { sessionId })),
  confirmRazorpay: (body: { orderId: string; paymentId: string; signature: string }) =>
    request<{ status: PaymentStatus; user: PublicUser }>('/billing/razorpay/confirm', json('POST', body)),

  // uploads and videos
  /** Uploads through this site to video storage; XHR so large videos can report progress. */
  upload: (file: Blob, onProgress?: (fraction: number) => void) =>
    new Promise<UploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/uploads');
      xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
      xhr.responseType = 'json';
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        const body = xhr.response as (UploadResult & { error?: string }) | null;
        if (xhr.status >= 200 && xhr.status < 300 && body?.url) return resolve(body);
        if (xhr.status === 401) onUnauthorized?.();
        reject(new ApiError(body?.error ?? `Upload failed (HTTP ${xhr.status})`, xhr.status));
      };
      xhr.onerror = () => reject(new ApiError('Upload failed. Check your connection and try again.', 0));
      xhr.send(file);
    }),
  createJobs: (body: CreateJobsRequest & { expectedTotalCents: number }) =>
    request<{ jobs: JobSummary[]; user: PublicUser }>('/jobs', json('POST', body)),
  /** Job list with ETag revalidation: `jobs` is undefined when nothing changed. */
  jobs: async (etag?: string): Promise<{ etag?: string; jobs?: JobSummary[] }> => {
    const response = await fetch('/api/jobs', { cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {} });
    if (response.status === 304) return { etag };
    if (response.status === 401) {
      onUnauthorized?.();
      throw new ApiError('Please log in', 401);
    }
    if (!response.ok) throw new ApiError(`Could not load your videos (HTTP ${response.status})`, response.status);
    const body = (await response.json()) as { jobs: JobSummary[] };
    return { etag: response.headers.get('ETag') ?? undefined, jobs: body.jobs };
  },
  job: (id: string) => request<Job>(`/jobs/${enc(id)}`),
  cancel: (id: string) => request<{ status: string; user: PublicUser }>(`/jobs/${enc(id)}/cancel`, { method: 'POST' }),
  refresh: (id: string) => request<{ status: string }>(`/jobs/${enc(id)}/refresh`, { method: 'POST' }),
  retry: (id: string, expectedPriceCents: number) =>
    request<{ id: string; user: PublicUser }>(`/jobs/${enc(id)}/retry`, json('POST', { expectedPriceCents })),
  remove: (id: string) => request<void>(`/jobs/${enc(id)}`, { method: 'DELETE' }),

  // admin
  admin: {
    overview: () => request<AdminOverview>('/admin/overview'),
    users: async (q = '') => (await request<{ users: AdminUserRow[] }>(`/admin/users?q=${enc(q)}`)).users,
    credit: (userId: string, amountCents: number, note: string) =>
      request<{ balanceCents: number }>(`/admin/users/${enc(userId)}/credit`, json('POST', { amountCents, note })),
    disable: (userId: string, disabled: boolean) => request<void>(`/admin/users/${enc(userId)}/disable`, json('POST', { disabled })),
    payments: async () => (await request<{ payments: PaymentRecord[] }>('/admin/payments')).payments,
    jobs: async () => (await request<{ jobs: AdminJobRow[] }>('/admin/jobs')).jobs,
    refund: (jobId: string) => request<{ refunded: boolean }>(`/admin/jobs/${enc(jobId)}/refund`, { method: 'POST' }),
    settings: () => request<{ pricing: Pricing; paymentProvider: string }>('/admin/settings'),
    saveSettings: (pricing: Pricing) => request<{ pricing: Pricing }>('/admin/settings', json('PUT', { pricing })),
  },
};
