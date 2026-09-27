/** Accounts: password hashing, cookie sessions, password-reset tokens and simple rate limits. */
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { PublicUser } from '../shared/types.ts';
import { nowIso, type DB } from './db.ts';
import { HttpProblem } from './requests.ts';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  balance_cents: number;
  disabled: number;
  created_at: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_MS = 30 * 86_400_000;
const RESET_MS = 60 * 60_000;

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [kind, n, r, p, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Checked when an email is unknown, so a login attempt takes the same time either way.
const DUMMY_HASH = await hashPassword(randomBytes(16).toString('hex'));

export function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpProblem(400, 'Enter a valid email address');
  return email;
}

export function checkNewPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8) throw new HttpProblem(400, 'Use a password of at least 8 characters');
  if (value.length > 200) throw new HttpProblem(400, 'That password is too long');
  return value;
}

/** Allows `max` hits per key within `windowMs`; in memory, per server process. */
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, message = 'Too many attempts. Please wait a few minutes and try again.') => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      throw new HttpProblem(429, message);
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 50_000) {
      for (const [k, times] of hits) if (times.every((t) => now - t >= windowMs)) hits.delete(k);
    }
  };
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

export function createAuth(db: DB, options: { adminEmails: Set<string>; secureCookies: boolean }) {
  const cookieName = options.secureCookies ? '__Host-sid' : 'sid';
  const findSession = db.prepare<[string, string], UserRow>(
    'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > ?',
  );
  const insertSession = db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
  const deleteSession = db.prepare('DELETE FROM sessions WHERE id = ?');

  const cookie = (token: string, expires: Date) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${options.secureCookies ? '; Secure' : ''}`;

  return {
    dummyHash: DUMMY_HASH,

    isAdmin: (user: UserRow) => options.adminEmails.has(user.email),

    publicUser(user: UserRow): PublicUser {
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        balanceCents: user.balance_cents,
        isAdmin: options.adminEmails.has(user.email),
        createdAt: user.created_at,
      };
    },

    /** Attach req.user when the session cookie is valid and the account is active. */
    loadUser(req: Request, _res: Response, next: NextFunction) {
      const token = parseCookies(req.headers.cookie)[cookieName];
      if (token) {
        const user = findSession.get(sha256(token), nowIso());
        if (user && !user.disabled) req.user = user;
      }
      next();
    },

    requireUser(req: Request): UserRow {
      if (!req.user) throw new HttpProblem(401, 'Please log in');
      return req.user;
    },

    requireAdmin(req: Request): UserRow {
      if (!req.user) throw new HttpProblem(401, 'Please log in');
      if (!options.adminEmails.has(req.user.email)) throw new HttpProblem(403, 'Admins only');
      return req.user;
    },

    startSession(res: Response, userId: string) {
      const token = randomBytes(32).toString('base64url');
      const expires = new Date(Date.now() + SESSION_MS);
      insertSession.run(sha256(token), userId, nowIso(), expires.toISOString());
      res.setHeader('Set-Cookie', cookie(token, expires));
    },

    endSession(req: Request, res: Response) {
      const token = parseCookies(req.headers.cookie)[cookieName];
      if (token) deleteSession.run(sha256(token));
      res.setHeader('Set-Cookie', cookie('', new Date(0)));
    },

    endAllSessions(userId: string) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    },

    createResetToken(userId: string): string {
      const token = randomBytes(32).toString('base64url');
      db.prepare('INSERT INTO password_resets (id, user_id, expires_at) VALUES (?, ?, ?)').run(
        sha256(token),
        userId,
        new Date(Date.now() + RESET_MS).toISOString(),
      );
      return token;
    },

    /** Returns the user id for a valid, unused, unexpired token, and marks it used. */
    consumeResetToken(token: string): string | undefined {
      const id = sha256(token);
      const row = db
        .prepare<[string, string], { user_id: string }>('SELECT user_id FROM password_resets WHERE id = ? AND used_at IS NULL AND expires_at > ?')
        .get(id, nowIso());
      if (!row) return undefined;
      db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(nowIso(), id);
      return row.user_id;
    },

    purgeExpired() {
      const now = nowIso();
      db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
      db.prepare('DELETE FROM password_resets WHERE expires_at <= ?').run(now);
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
