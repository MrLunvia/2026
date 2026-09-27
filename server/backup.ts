/**
 * Copies the live database (accounts, balances, payments, videos) to DATA_DIR/backups/ while the site keeps running.
 * Usage: `npm run backup` (or, in Docker: `docker compose exec app npm run backup`). Keeps the newest 14 copies.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config as loadEnv } from 'dotenv';

const root = fileURLToPath(new URL('..', import.meta.url));
loadEnv({ path: path.join(root, '.env.local'), quiet: true });

const KEEP = 14;
const dataDir = path.resolve(root, process.env.DATA_DIR?.trim() || 'data');
const dir = path.join(dataDir, 'backups');
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const target = path.join(dir, `platform-${stamp}.db`);
const db = new Database(path.join(dataDir, 'platform.db'), { readonly: true, fileMustExist: true });
await db.backup(target);
db.close();
console.log(`Backup written: ${target}`);

const old = readdirSync(dir)
  .filter((name) => /^platform-.*\.db$/.test(name))
  .sort()
  .slice(0, -KEEP);
for (const name of old) rmSync(path.join(dir, name));
if (old.length > 0) console.log(`Removed ${old.length} older backup(s)`);
