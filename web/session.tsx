/** Site config and the logged-in customer, shared by every page. */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { formatMoney } from '../shared/pricing.ts';
import type { PublicConfig, PublicUser } from '../shared/types.ts';
import { api, setUnauthorizedHandler } from './api.ts';

interface Session {
  config?: PublicConfig;
  configError?: string;
  /** undefined while loading, null when logged out. */
  user?: PublicUser | null;
  setUser(user: PublicUser | null): void;
  refreshUser(): Promise<void>;
  refreshConfig(): Promise<void>;
  money(cents: number): string;
}

const SessionContext = createContext<Session | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig>();
  const [configError, setConfigError] = useState<string>();
  const [user, setUser] = useState<PublicUser | null>();

  const refreshConfig = useCallback(async () => {
    try {
      setConfig(await api.config());
      setConfigError(undefined);
    } catch (error) {
      setConfigError((error as Error).message);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refreshConfig();
    void refreshUser();
    setUnauthorizedHandler(() => setUser(null));
  }, [refreshConfig, refreshUser]);

  useEffect(() => {
    if (config) document.title = config.appName;
  }, [config]);

  const value = useMemo<Session>(
    () => ({
      config,
      configError,
      user,
      setUser,
      refreshUser,
      refreshConfig,
      money: (cents: number) => formatMoney(cents, config?.pricing.currency ?? 'USD'),
    }),
    [config, configError, user, refreshUser, refreshConfig],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession outside SessionProvider');
  return session;
}
