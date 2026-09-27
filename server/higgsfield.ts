/**
 * Server-side Higgsfield access. Submission goes through the official SDK's subscribe();
 * status, cancel and presigned upload use the documented REST endpoints, since the v2 SDK
 * exposes only subscribe(). Credentials never leave this module, and every failure is turned
 * into a HiggsfieldError whose message is safe to show (raw axios errors carry the
 * Authorization header, so they are never passed on).
 */
import axios from 'axios';
import {
  APIError,
  AuthenticationError,
  BadInputError,
  NotEnoughCreditsError,
  ValidationError,
  createHiggsfieldClient,
} from '@higgsfield/client/v2';

export class HiggsfieldError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
    /** Worth retrying later (network trouble, 429, 5xx). Submissions are still never retried. */
    readonly transient = false,
  ) {
    super(message);
    this.name = 'HiggsfieldError';
  }
}

export interface RemoteStatus {
  status: string;
  videoUrl?: string;
  reason?: string;
}

export interface HiggsfieldApi {
  submit(endpoint: string, input: Record<string, unknown>): Promise<{ requestId: string; status: string }>;
  status(requestId: string): Promise<RemoteStatus>;
  /** `too-late` once generation has started: Higgsfield cancels only queued requests. */
  cancel(requestId: string): Promise<'canceled' | 'too-late'>;
  upload(bytes: Buffer, contentType: string): Promise<string>;
}

export function createHiggsfieldApi(options: { credentials: string; baseUrl: string }): HiggsfieldApi {
  const sdk = createHiggsfieldClient({
    credentials: options.credentials,
    baseURL: options.baseUrl,
    // The SDK would retry a failed submission, which can start a second billable generation.
    maxRetries: 0,
  });
  const http = axios.create({
    baseURL: options.baseUrl,
    timeout: 60_000,
    headers: { Authorization: `Key ${options.credentials}` },
  });

  return {
    async submit(endpoint, input) {
      try {
        const accepted = await sdk.subscribe(endpoint, { input, withPolling: false });
        if (!accepted.request_id) throw new HiggsfieldError('Higgsfield accepted the request but returned no request_id');
        return { requestId: accepted.request_id, status: accepted.status };
      } catch (error) {
        throw toHiggsfieldError(error);
      }
    },

    async status(requestId) {
      try {
        const { data } = await http.get(`/requests/${encodeURIComponent(requestId)}/status`);
        const videoUrl = data?.video?.url;
        return {
          status: String(data?.status),
          // Only web URLs reach the page's player and links.
          videoUrl: typeof videoUrl === 'string' && isAcceptableUrl(videoUrl) ? videoUrl : undefined,
          reason: reasonFrom(data?.error) ?? reasonFrom(data) ?? otherFields(data),
        };
      } catch (error) {
        throw toHiggsfieldError(error);
      }
    },

    async cancel(requestId) {
      try {
        await http.post(`/requests/${encodeURIComponent(requestId)}/cancel`);
        return 'canceled';
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 400) return 'too-late';
        throw toHiggsfieldError(error);
      }
    },

    async upload(bytes, contentType) {
      try {
        const { data } = await http.post('/files/generate-upload-url', { content_type: contentType });
        const uploadUrl = serviceUrl(data?.upload_url, 'upload URL');
        const publicUrl = serviceUrl(data?.public_url, 'public file URL');
        const headers: Record<string, string> = { 'Content-Type': contentType };
        for (const [name, value] of Object.entries(data?.upload_headers ?? {})) {
          if (typeof value === 'string') headers[name] = value;
        }
        // Presigned storage URL: send the file only, never the API credentials.
        await axios.put(uploadUrl, bytes, { headers, timeout: 120_000, maxBodyLength: Infinity });
        return publicUrl;
      } catch (error) {
        throw toHiggsfieldError(error);
      }
    },
  };
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

/** HTTPS, or plain HTTP on loopback (local testing against a mock API). */
export function isAcceptableUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname));
  } catch {
    return false;
  }
}

function serviceUrl(value: unknown, what: string): string {
  if (typeof value === 'string' && isAcceptableUrl(value)) return value;
  throw new HiggsfieldError(`Higgsfield returned no usable ${what}`);
}

/** Signed input/output URLs can appear in error text; keep the reason, not the access link. */
function clean(text: string): string {
  const flat = text.replace(/https?:\/\/[^\s"'<>)\]}]+/gi, '[url]').replace(/\s+/g, ' ').trim();
  return flat.length > 400 ? `${flat.slice(0, 400)}…` : flat;
}

function reasonFrom(data: unknown): string | undefined {
  if (typeof data === 'string') return data.trim() && !data.trimStart().startsWith('<') ? clean(data) : undefined;
  if (!data || typeof data !== 'object') return undefined;
  const { detail, message, error } = data as Record<string, unknown>;
  if (typeof detail === 'string' && detail.trim()) return clean(detail);
  if (Array.isArray(detail) && detail.length > 0) {
    return clean(
      detail
        .map((item) => {
          const { loc, msg } = (item ?? {}) as { loc?: unknown; msg?: unknown };
          const where = Array.isArray(loc) ? loc.filter((part) => part !== 'body').join('.') : '';
          return where ? `${where}: ${String(msg)}` : String(msg ?? item);
        })
        .join('; '),
    );
  }
  if (typeof message === 'string' && message.trim()) return clean(message);
  if (error !== undefined) return reasonFrom(error);
  return undefined;
}

/** Whatever else a status response carries, for failures whose reason isn't in a known field. */
function otherFields(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const { status: _s, request_id: _r, status_url: _su, cancel_url: _cu, video: _v, images: _i, ...rest } = data as Record<string, unknown>;
  const present = Object.entries(rest).filter(([, value]) => value !== null && value !== undefined && value !== '');
  return present.length > 0 ? clean(JSON.stringify(Object.fromEntries(present))) : undefined;
}

function withReason(prefix: string, reason: string | undefined): string {
  return reason ? `${prefix}: ${reason}` : prefix;
}

export function toHiggsfieldError(error: unknown): HiggsfieldError {
  if (error instanceof HiggsfieldError) return error;
  if (error instanceof AuthenticationError) {
    return new HiggsfieldError('Authentication failed (HTTP 401): check HF_CREDENTIALS', 401);
  }
  if (error instanceof NotEnoughCreditsError) {
    // The SDK reports every HTTP 403 this way, including a blocked network route.
    return new HiggsfieldError('HTTP 403: not enough credits, or access to the Higgsfield API was denied', 403);
  }
  if (error instanceof ValidationError || error instanceof BadInputError) {
    const reason = error.details ? reasonFrom({ detail: error.details }) : clean(error.message);
    return new HiggsfieldError(withReason(`Invalid input (HTTP ${error.statusCode})`, reason), error.statusCode);
  }
  if (error instanceof APIError) {
    const status = error.statusCode;
    return new HiggsfieldError(
      withReason(`Higgsfield API error (HTTP ${status ?? 'unknown'})`, reasonFrom(error.responseData)),
      status,
      status === undefined || status >= 500 || status === 429,
    );
  }
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (status !== undefined) {
      return new HiggsfieldError(
        withReason(`Higgsfield API error (HTTP ${status})`, reasonFrom(error.response?.data)),
        status,
        status >= 500 || status === 429,
      );
    }
    return new HiggsfieldError(`Could not reach Higgsfield (${error.code ?? 'network error'})`, undefined, true);
  }
  return new HiggsfieldError(error instanceof Error ? clean(error.message) : 'Unexpected error');
}
