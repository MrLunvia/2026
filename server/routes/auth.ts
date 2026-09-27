/** Sign up, log in/out, current user, password reset and change. */
import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import { checkNewPassword, hashPassword, normalizeEmail, rateLimiter, verifyPassword } from '../auth.ts';
import { nowIso } from '../db.ts';
import { HttpProblem } from '../requests.ts';
import { siteUrl, smallJson, userByEmail, userById, type Deps } from './context.ts';

export function authRoutes(router: Router, { db, config, auth, billing, mailer }: Deps): void {
  const signupLimit = rateLimiter(10, 60 * 60_000);
  const loginIpLimit = rateLimiter(30, 15 * 60_000);
  const loginEmailLimit = rateLimiter(10, 15 * 60_000);
  const resetLimit = rateLimiter(5, 60 * 60_000);

  router.get('/auth/me', (req, res) => {
    res.json({ user: req.user ? auth.publicUser(req.user) : null });
  });

  router.post('/auth/signup', smallJson, async (req, res) => {
    signupLimit(`ip:${req.ip}`);
    const email = normalizeEmail(req.body?.email);
    const password = checkNewPassword(req.body?.password);
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';
    if (req.body?.acceptTerms !== true) throw new HttpProblem(400, 'Please accept the Terms of Service');
    if (userByEmail(db, email)) throw new HttpProblem(409, 'An account with this email already exists. Log in instead.');
    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    db.transaction(() => {
      db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(id, email, name, passwordHash, nowIso());
      const bonus = billing.pricing().signupBonusCents;
      if (bonus > 0) billing.move(id, bonus, 'bonus', { note: 'Welcome credit' });
    })();
    auth.startSession(res, id);
    console.log(`New account: ${email}`);
    res.status(201).json({ user: auth.publicUser(userById(db, id)!) });
  });

  router.post('/auth/login', smallJson, async (req, res) => {
    loginIpLimit(`ip:${req.ip}`);
    const email = normalizeEmail(req.body?.email);
    loginEmailLimit(`email:${email}`);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const user = userByEmail(db, email);
    // Always hash, so unknown emails take as long as wrong passwords.
    const valid = await verifyPassword(password, user?.password_hash ?? auth.dummyHash);
    if (!user || !valid) throw new HttpProblem(401, 'Email or password is incorrect');
    if (user.disabled) throw new HttpProblem(403, 'This account has been disabled. Please contact support.');
    auth.startSession(res, user.id);
    res.json({ user: auth.publicUser(user) });
  });

  router.post('/auth/logout', (req, res) => {
    auth.endSession(req, res);
    res.status(204).end();
  });

  router.post('/auth/forgot', smallJson, async (req, res) => {
    resetLimit(`ip:${req.ip}`);
    const email = normalizeEmail(req.body?.email);
    if (!mailer) {
      throw new HttpProblem(503, `Password reset by email is not set up yet. ${config.supportEmail ? `Please contact ${config.supportEmail}.` : 'Please contact support.'}`);
    }
    const user = userByEmail(db, email);
    if (user && !user.disabled) {
      const link = `${siteUrl(config, req)}/reset?token=${auth.createResetToken(user.id)}`;
      const text = `Hi${user.name ? ` ${user.name}` : ''},\n\nUse this link to set a new ${config.appName} password:\n${link}\n\nIt expires in 1 hour. If you didn't ask for this, you can ignore this email.`;
      await mailer.send(user.email, `Reset your ${config.appName} password`, text).catch((error: Error) => {
        console.error(`Could not send the reset email: ${error.message}`);
      });
    }
    // Same answer either way, so this can't be used to find out who has an account.
    res.json({ ok: true });
  });

  router.post('/auth/reset', smallJson, async (req, res) => {
    const password = checkNewPassword(req.body?.password);
    const token = typeof req.body?.token === 'string' ? req.body.token : '';
    const userId = token ? auth.consumeResetToken(token) : undefined;
    if (!userId) throw new HttpProblem(400, 'This reset link is invalid or has expired. Please request a new one.');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), userId);
    auth.endAllSessions(userId);
    auth.startSession(res, userId);
    res.json({ user: auth.publicUser(userById(db, userId)!) });
  });

  router.post('/auth/password', smallJson, async (req, res) => {
    const user = auth.requireUser(req);
    if (!(await verifyPassword(String(req.body?.currentPassword ?? ''), user.password_hash))) {
      throw new HttpProblem(400, 'Your current password is incorrect');
    }
    const password = checkNewPassword(req.body?.newPassword);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
    auth.endAllSessions(user.id);
    auth.startSession(res, user.id);
    res.status(204).end();
  });
}
