/** Owner dashboard: numbers, customers, credit adjustments, payments, all videos, pricing. */
import type { Router } from 'express';
import type { AdminOverview, AdminUserRow } from '../../shared/types.ts';
import type { UserRow } from '../auth.ts';
import { HttpProblem } from '../requests.ts';
import { smallJson, userById, type Deps } from './context.ts';

export function adminRoutes(router: Router, { db, config, auth, billing, store, runner }: Deps): void {
  const count = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(...params) as { n: number | null }).n ?? 0;

  router.get('/admin/overview', (req, res) => {
    auth.requireAdmin(req);
    const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const body: AdminOverview = {
      service: runner.serviceStatus(),
      users: count('SELECT COUNT(*) AS n FROM users'),
      payingUsers: count("SELECT COUNT(DISTINCT user_id) AS n FROM payments WHERE status = 'paid'"),
      revenueCents: count("SELECT SUM(amount_cents) AS n FROM payments WHERE status = 'paid'"),
      revenue7dCents: count("SELECT SUM(amount_cents) AS n FROM payments WHERE status = 'paid' AND paid_at >= ?", weekAgo),
      outstandingCents: count('SELECT SUM(balance_cents) AS n FROM users'),
      videosCompleted: count("SELECT COUNT(*) AS n FROM jobs WHERE status = 'completed'"),
      videosCompleted7d: count("SELECT COUNT(*) AS n FROM jobs WHERE status = 'completed' AND finished_at >= ?", weekAgo),
      videosActive: count("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('pending', 'submitting', 'queued', 'in_progress')"),
      videosRefunded: count('SELECT COUNT(*) AS n FROM jobs WHERE refunded_at IS NOT NULL'),
    };
    res.json(body);
  });

  router.get('/admin/users', (req, res) => {
    auth.requireAdmin(req);
    const query = String(req.query.q ?? '').trim().toLowerCase();
    const like = `%${query.replace(/[%_]/g, '')}%`;
    const rows = db
      .prepare<[string, string, string], UserRow & { spent: number; videos: number }>(
        `SELECT u.*,
           COALESCE((SELECT SUM(p.amount_cents) FROM payments p WHERE p.user_id = u.id AND p.status = 'paid'), 0) AS spent,
           (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id AND j.status = 'completed') AS videos
         FROM users u
         WHERE ? = '' OR u.email LIKE ? OR lower(u.name) LIKE ?
         ORDER BY u.created_at DESC LIMIT 300`,
      )
      .all(query, like, like);
    const users: AdminUserRow[] = rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      balanceCents: row.balance_cents,
      spentCents: row.spent,
      videos: row.videos,
      disabled: row.disabled === 1,
      isAdmin: auth.isAdmin(row),
      createdAt: row.created_at,
    }));
    res.json({ users });
  });

  router.post('/admin/users/:id/credit', smallJson, (req, res) => {
    const admin = auth.requireAdmin(req);
    const user = userById(db, req.params.id);
    if (!user) throw new HttpProblem(404, 'No such user');
    const amountCents = req.body?.amountCents;
    if (typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents === 0 || Math.abs(amountCents) > 100_000_000) {
      throw new HttpProblem(400, 'Enter a non-zero amount');
    }
    const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 200) : 'Manual adjustment';
    const balanceCents = db.transaction(() => billing.move(user.id, amountCents, 'adjustment', { note, actor: admin.email }))();
    console.log(`Admin ${admin.email} adjusted ${user.email} by ${amountCents} (${note})`);
    res.json({ balanceCents });
  });

  router.post('/admin/users/:id/disable', smallJson, (req, res) => {
    const admin = auth.requireAdmin(req);
    const user = userById(db, req.params.id);
    if (!user) throw new HttpProblem(404, 'No such user');
    const disabled = req.body?.disabled === true;
    if (user.id === admin.id && disabled) throw new HttpProblem(400, "You can't disable your own account");
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, user.id);
    if (disabled) auth.endAllSessions(user.id);
    res.status(204).end();
  });

  router.get('/admin/payments', (req, res) => {
    auth.requireAdmin(req);
    res.json({ payments: billing.payments({ limit: 300 }) });
  });

  router.get('/admin/jobs', (req, res) => {
    auth.requireAdmin(req);
    res.json({ jobs: store.listAll(300) });
  });

  router.post('/admin/jobs/:id/refund', (req, res) => {
    const admin = auth.requireAdmin(req);
    res.json({ refunded: runner.adminRefund(req.params.id, admin.email) });
  });

  // Only the owner's own videos: customers' videos stay private.
  router.post('/admin/jobs/:id/feature', smallJson, (req, res) => {
    const admin = auth.requireAdmin(req);
    const row = store.owned(req.params.id, admin.id);
    store.setFeatured(row, req.body?.featured === true);
    res.json({ featured: row.featured_at !== null });
  });

  router.get('/admin/settings', (req, res) => {
    auth.requireAdmin(req);
    res.json({ pricing: billing.pricing(), paymentProvider: config.payments.provider });
  });

  router.put('/admin/settings', smallJson, (req, res) => {
    const admin = auth.requireAdmin(req);
    const pricing = billing.updatePricing(req.body?.pricing);
    console.log(`Admin ${admin.email} updated pricing`);
    res.json({ pricing });
  });
}
