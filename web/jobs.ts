/** Generation history: polls the server (cheaply, via ETag) faster while anything is running. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ACTIVE_STATUSES, type JobSummary } from '../shared/types.ts';
import { api } from './api.ts';

const ACTIVE_POLL_MS = 2_500;
const IDLE_POLL_MS = 10_000;

export function useJobs() {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string>();
  const etag = useRef<string | undefined>(undefined);
  const hasActive = jobs.some((job) => ACTIVE_STATUSES.includes(job.status));

  const refresh = useCallback(async () => {
    try {
      const result = await api.jobs(etag.current);
      etag.current = result.etag;
      if (result.jobs) setJobs(result.jobs);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh, hasActive]);

  return { jobs, loaded, error, hasActive, refresh };
}

/** Current time for elapsed timers and "5 min ago" labels: every second while `fast`, else twice a minute. */
export function useNow(fast: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), fast ? 1_000 : 30_000);
    return () => clearInterval(timer);
  }, [fast]);
  return now;
}
