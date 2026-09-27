/** What every route module gets, plus small shared helpers. */
import express, { type Request } from 'express';
import type { Auth, UserRow } from '../auth.ts';
import type { Billing } from '../billing.ts';
import type { PlatformConfig } from '../config.ts';
import type { DB } from '../db.ts';
import type { HiggsfieldApi } from '../higgsfield.ts';
import type { JobRunner, JobStore } from '../jobs.ts';
import type { Mailer } from '../mailer.ts';

export interface Deps {
  db: DB;
  config: PlatformConfig;
  auth: Auth;
  billing: Billing;
  store: JobStore;
  runner: JobRunner;
  api: HiggsfieldApi | undefined;
  mailer: Mailer | undefined;
  allowedHosts: Set<string>;
  environment: 'local' | 'codespaces';
  production: boolean;
}

export const smallJson = express.json({ limit: '20kb' });

/** The site's public address: PUBLIC_URL, or what this request came in on. */
export function siteUrl(config: PlatformConfig, req: Request): string {
  return config.publicUrl ?? `${req.protocol}://${req.get('host')}`;
}

export function userById(db: DB, id: string): UserRow | undefined {
  return db.prepare<[string], UserRow>('SELECT * FROM users WHERE id = ?').get(id);
}

export function userByEmail(db: DB, email: string): UserRow | undefined {
  return db.prepare<[string], UserRow>('SELECT * FROM users WHERE email = ?').get(email);
}
