/** SQLite storage (one file in DATA_DIR) with versioned migrations. */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY, -- SHA-256 of the cookie token; the token itself is never stored
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE password_resets (
    id TEXT PRIMARY KEY, -- SHA-256 of the emailed token
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT
  );

  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    batch_id TEXT NOT NULL,
    batch_index INTEGER NOT NULL,
    batch_size INTEGER NOT NULL,
    title TEXT,
    prompt TEXT NOT NULL,
    prompt_preview TEXT NOT NULL,
    word_count INTEGER NOT NULL,
    settings TEXT NOT NULL,
    media TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    status TEXT NOT NULL,
    request_id TEXT,
    video_url TEXT,
    error TEXT,
    detail TEXT, -- technical reason, shown to admins only
    price_cents INTEGER NOT NULL,
    refunded_at TEXT,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    submitted_at TEXT,
    finished_at TEXT
  );
  CREATE INDEX jobs_user_created ON jobs(user_id, created_at DESC);
  CREATE INDEX jobs_status ON jobs(status);

  CREATE TABLE ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL,
    balance_after_cents INTEGER NOT NULL,
    kind TEXT NOT NULL, -- purchase | generation | refund | adjustment | bonus
    job_id TEXT,
    payment_id TEXT,
    note TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX ledger_user ON ledger(user_id, id DESC);

  CREATE TABLE payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    provider TEXT NOT NULL,
    provider_ref TEXT, -- Stripe Checkout session id or Razorpay order id
    provider_payment_id TEXT,
    amount_cents INTEGER NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL, -- pending | paid | failed
    created_at TEXT NOT NULL,
    paid_at TEXT
  );
  CREATE UNIQUE INDEX payments_ref ON payments(provider, provider_ref);
  CREATE INDEX payments_user ON payments(user_id, created_at DESC);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // v2: who made a manual balance change (admin email), kept for the owner's records only.
  `ALTER TABLE ledger ADD COLUMN actor TEXT;`,
  // v3: files customers uploaded, with the video lengths prices are based on.
  `
  CREATE TABLE uploads (
    url TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    kind TEXT NOT NULL, -- image | video | audio
    content_type TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    seconds REAL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX uploads_user ON uploads(user_id, created_at DESC);
  `,
];

export function openDatabase(file: string): DB {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

export const nowIso = () => new Date().toISOString();
