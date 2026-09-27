/** A small history-API router: enough for a handful of pages, no dependency. */
import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (options.replace) history.replaceState(null, '', to);
  else history.pushState(null, '', to);
  listeners.forEach((listener) => listener());
  const hash = to.split('#')[1];
  if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }));
  else window.scrollTo(0, 0);
}

/** Only same-site paths, so `?next=` can't send people to another website. */
export function safeNext(next: string | null, fallback = '/app'): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : fallback;
}

/** Current path plus query string; re-renders on navigation. */
export function useLocation(): { path: string; query: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, () => location.pathname + location.search);
  const [path, search = ''] = href.split('?');
  return { path: path || '/', query: new URLSearchParams(search) };
}

export function Link({ to, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (to.startsWith('#')) return;
        event.preventDefault();
        navigate(to);
      }}
      {...props}
    />
  );
}
