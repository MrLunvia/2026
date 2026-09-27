const numberFormat = new Intl.NumberFormat('en-US');

export const formatNumber = (n: number) => numberFormat.format(n);

export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${seconds}s`;
}

export function timeAgo(iso: string, now: number): string {
  const diff = now - Date.parse(iso);
  if (diff < 45_000) return 'just now';
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Works outside secure contexts too (crypto.randomUUID needs HTTPS or localhost). */
export function uid(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${formatNumber(n)} ${n === 1 ? one : many}`;
