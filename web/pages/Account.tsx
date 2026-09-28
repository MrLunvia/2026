/** The customer's balance, activity, payments and password. */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { headlinePriceCents } from '../../shared/pricing.ts';
import type { LedgerEntry, LedgerKind, PaymentRecord } from '../../shared/types.ts';
import { api } from '../api.ts';
import { BuyCreditsDialog } from '../components/BuyCredits.tsx';
import { SiteFooter, SiteHeader } from '../components/Chrome.tsx';
import { Icon } from '../components/Icon.tsx';
import { useSession } from '../session.tsx';
import { useUi } from '../ui.tsx';

const KIND: Record<LedgerKind, string> = {
  purchase: 'Credit purchase',
  generation: 'Video',
  refund: 'Refund',
  adjustment: 'Adjustment',
  bonus: 'Bonus',
};

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export function PaymentStatusBadge({ status }: { status: PaymentRecord['status'] }) {
  const tone = status === 'paid' ? 'success' : status === 'failed' ? 'danger' : 'neutral';
  return <span className={`badge badge-${tone}`}>{status === 'paid' ? 'Paid' : status === 'failed' ? 'Failed' : 'Not completed'}</span>;
}

export function Account() {
  const { user: maybeUser, setUser, money, config } = useSession();
  const user = maybeUser!;
  const { notify } = useUi();
  const [ledger, setLedger] = useState<LedgerEntry[]>();
  const [payments, setPayments] = useState<PaymentRecord[]>();
  const [error, setError] = useState<string>();
  const [buying, setBuying] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const result = await api.billing();
      setLedger(result.ledger);
      setPayments(result.payments);
      setUser(result.user);
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [setUser]);

  // Reload the history whenever the balance changes (e.g. after buying credit).
  useEffect(() => {
    void load();
  }, [load, user.balanceCents]);

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordError(undefined);
    if (next.length < 8) return setPasswordError('Use at least 8 characters for your new password');
    if (next !== repeat) return setPasswordError("The two new passwords don't match");
    setSaving(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      setRepeat('');
      notify('Password changed. Other devices were logged out.', 'success');
    } catch (e) {
      setPasswordError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const perVideo = config ? headlinePriceCents(config.pricing) : 0;
  const videosLeft = perVideo > 0 ? Math.floor(user.balanceCents / perVideo) : 0;

  return (
    <div className="app">
      <SiteHeader />
      <main className="page">
        <header className="page-head">
          <h1>Account</h1>
          <p className="muted">
            {user.name ? `${user.name} · ` : ''}
            {user.email} · member since {new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </p>
        </header>

        {error && (
          <p className="banner banner-error">
            <Icon name="alert" size={16} />
            {error}
          </p>
        )}

        <section className="card balance-card">
          <div>
            <span className="stat-label">Balance</span>
            <strong className="balance-amount">{money(user.balanceCents)}</strong>
            <span className="muted">
              {videosLeft > 0
                ? `Enough for ${videosLeft} × 30-second 720p Seedance 2.5 video${videosLeft === 1 ? '' : 's'}`
                : `A 30-second 720p Seedance 2.5 video costs ${money(perVideo)}`}
            </span>
          </div>
          <button type="button" className="button button-primary button-large" onClick={() => setBuying(true)}>
            <Icon name="plus" size={16} />
            Buy credit
          </button>
        </section>

        <section className="card">
          <div className="card-heading">
            <h2>Activity</h2>
            <p className="hint">Every charge, refund and top-up on your balance</p>
          </div>
          {!ledger ? (
            <div className="loading">
              <span className="spinner" /> Loading…
            </div>
          ) : ledger.length === 0 ? (
            <p className="muted">Nothing yet. Buy credit to start creating.</p>
          ) : (
            <div className="table-wrap">
              <table className="table table-stack table-ledger">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="num">Amount</th>
                    <th className="num">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((entry) => (
                    <tr key={entry.id}>
                      <td className="nowrap">{formatDate(entry.createdAt)}</td>
                      <td>
                        <strong>{KIND[entry.kind]}</strong>
                        {entry.note && <span className="muted"> · {entry.note}</span>}
                      </td>
                      <td className={entry.amountCents >= 0 ? 'num is-positive' : 'num'}>
                        {entry.amountCents >= 0 ? '+' : '−'}
                        {money(Math.abs(entry.amountCents))}
                      </td>
                      <td className="num" data-label="Balance">
                        {money(entry.balanceAfterCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-heading">
            <h2>Payments</h2>
          </div>
          {!payments ? (
            <div className="loading">
              <span className="spinner" /> Loading…
            </div>
          ) : payments.length === 0 ? (
            <p className="muted">No payments yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="table table-stack table-payments">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Reference</th>
                    <th>Status</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr key={payment.id}>
                      <td className="nowrap">{formatDate(payment.createdAt)}</td>
                      <td data-label="Ref.">
                        <code>{payment.id.slice(0, 8)}</code>
                      </td>
                      <td>
                        <PaymentStatusBadge status={payment.status} />
                      </td>
                      <td className="num">{money(payment.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-heading">
            <h2>Change password</h2>
          </div>
          <form className="form form-narrow" onSubmit={(e) => void changePassword(e)} noValidate>
            <input type="email" value={user.email} autoComplete="username" hidden readOnly />
            <label className="form-field">
              <span>Current password</span>
              <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            </label>
            <label className="form-field">
              <span>New password</span>
              <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
            </label>
            <label className="form-field">
              <span>Repeat new password</span>
              <input className="input" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required />
            </label>
            {passwordError && (
              <p className="banner banner-error" role="alert">
                <Icon name="alert" size={16} />
                {passwordError}
              </p>
            )}
            <button type="submit" className="button button-primary" disabled={saving || !current || !next}>
              {saving && <span className="spinner" />}
              Change password
            </button>
          </form>
        </section>
      </main>
      <SiteFooter />
      <BuyCreditsDialog open={buying} onClose={() => setBuying(false)} />
    </div>
  );
}
