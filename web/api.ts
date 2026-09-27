/** Browser-side calls to this app's server. The Higgsfield key never reaches the browser. */
import type { AppConfig, CreateJobsRequest, Job, JobSummary } from '../shared/types.ts';

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
    throw new Error(message);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const post = (path: string) => request<unknown>(path, { method: 'POST' });

export const api = {
  config: () => request<AppConfig>('/config'),

  upload: async (file: Blob) =>
    (await request<{ url: string }>('/uploads', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    })).url,

  createJobs: async (body: CreateJobsRequest) =>
    (await request<{ jobs: JobSummary[] }>('/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })).jobs,

  /** Job list with ETag revalidation: `jobs` is undefined when nothing changed. */
  jobs: async (etag?: string): Promise<{ etag?: string; jobs?: JobSummary[] }> => {
    const response = await fetch('/api/jobs', { cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {} });
    if (response.status === 304) return { etag };
    if (!response.ok) throw new Error(`Could not load generations (HTTP ${response.status})`);
    const body = (await response.json()) as { jobs: JobSummary[] };
    return { etag: response.headers.get('ETag') ?? undefined, jobs: body.jobs };
  },

  job: (id: string) => request<Job>(`/jobs/${encodeURIComponent(id)}`),
  cancel: (id: string) => post(`/jobs/${encodeURIComponent(id)}/cancel`),
  refresh: (id: string) => post(`/jobs/${encodeURIComponent(id)}/refresh`),
  retry: (id: string) => post(`/jobs/${encodeURIComponent(id)}/retry`),
  remove: (id: string) => request<void>(`/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};
