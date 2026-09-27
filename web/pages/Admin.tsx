/** Owner dashboard: sales, customers, credit adjustments, all videos with refunds, payments and pricing. */
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { RESOLUTIONS } from '../../shared/options.ts';
import { videoPriceCents } from '../../shared/pricing.ts';
import {
  ACTIVE_STATUSES,
  type AdminJobRow,
  type AdminOverview,
  type AdminUserRow,
  type JobStatus,
  type PaymentRecord,
  type Pricing,
} from '../../shared/types.ts';
import { api } from '../api.ts';
import { SiteFooter, SiteHeader } from '../components/Chrome.tsx';
import { Dialog } from '../components/Dialog.tsx';
import { Icon, type IconName } from '../components/Icon.tsx';
import { formatNumber } from '../format.ts';
import { navigate, useLocation } from '../router.tsx';
import { useSession } from '../session.tsx';
import { useUi } from '../ui.tsx';
import { formatDate, PaymentStatusBadge } from './Account.tsx';

type Tab = 'overview' | 'customers' | 'videos' | 'payments' | 'pricing';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'overview', label: 'Overview', icon: 'chart' },
  { id: 'customers', label: 'Customers', icon: 'user' },
  { id: 'videos', label: 'Videos', icon: 'film' },
  { id: 'payments', label: 'Payments', icon: 'wallet' },
  { id: 'pricing', label: 'Pricing', icon: 'zap' },
];

const STATUS_TONE: Record<JobStatus, string> = {
  pending: 'neutral',
  submitting: 'info',
  queued: 'info',
  in_progress: 'progress',
  completed: 'success',
  failed: 'danger',
  nsfw: 'warning',
  canceled: 'neutral',
  error: 'danger',
};
const STATUS_LABEL: Record<JobStatus, string> = {
  pending: 'Waiting',
  submitting: 'Submitting',
  queued: 'Queued',
  in_progress: 'Generating',
  completed: 'Completed',
  failed: 'Failed',
  nsfw: 'Moderated',
  canceled: 'Canceled',
  error: 'Error',
};

/** Loads data for a tab and exposes a reload; errors are shown in place. */
function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError(undefined);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [load]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, reload };
}

function Loading({ error, children }: { error?: string; children?: ReactNode }) {
  if (error)
    return (
      <p className="banner banner-error">
        <Icon name="alert" size={16} />
        {error}
      </p>
    );
  return (
    children ?? (
      <div className="loading">
        <span className="spinner" /> Loading…
      </div>
    )
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="stat card">
      <span className="stat-label">{label}</span>
      <strong className="stat-value">{value}</strong>
      {sub && <span className="muted">{sub}</span>}
    </div>
  );
}

function Overview() {
  const { money } = useSession();
  const { data, error } = useLoad(api.admin.overview);
  if (!data) return <Loading error={error} />;
  const service = data.service;
  return (
    <>
      {service.paused && (
        <div className="banner banner-warning">
          <Icon name="alert" size={16} />
          <div>
            <strong>New videos are on hold.</strong>
            <p>
              {service.reason ?? 'The video provider is not accepting requests.'}
              {service.until && ` Retrying automatically at ${new Date(service.until).toLocaleTimeString()}.`} Queued videos are kept and
              start once this clears; customers are not charged twice.
            </p>
          </div>
        </div>
      )}
      <div className="stat-grid">
        <Stat label="Revenue" value={money(data.revenueCents)} sub={`${money(data.revenue7dCents)} in the last 7 days`} />
        <Stat label="Customers" value={formatNumber(data.users)} sub={`${formatNumber(data.payingUsers)} ${data.payingUsers === 1 ? 'has' : 'have'} paid`} />
        <Stat label="Videos made" value={formatNumber(data.videosCompleted)} sub={`${formatNumber(data.videosCompleted7d)} in the last 7 days`} />
        <Stat label="Running now" value={formatNumber(data.videosActive)} />
        <Stat label="Refunded videos" value={formatNumber(data.videosRefunded)} />
        <Stat label="Unspent customer credit" value={money(data.outstandingCents)} sub="What you still owe in videos" />
      </div>
    </>
  );
}

function CreditDialog({ user, onClose, onDone }: { user?: AdminUserRow; onClose: () => void; onDone: () => void }) {
  const { money, config } = useSession();
  const { notify } = useUi();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const cents = Math.round(Number(amount) * 100);
  const valid = amount.trim() !== '' && Number.isFinite(cents) && cents !== 0;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user || !valid) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api.admin.credit(user.id, cents, note);
      notify(`${user.email}: balance is now ${money(result.balanceCents)}`, 'success');
      setAmount('');
      setNote('');
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={user !== undefined} title="Adjust credit" onClose={onClose}>
      {user && (
        <form className="form" onSubmit={(e) => void submit(e)}>
          <p className="dialog-lead">
            {user.email} has {money(user.balanceCents)}. Use a negative amount to remove credit.
          </p>
          <label className="form-field">
            <span>Amount ({config?.pricing.currency})</span>
            <input className="input" type="number" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12.00" autoFocus required />
          </label>
          <label className="form-field">
            <span>Note (visible to the customer)</span>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Paid by bank transfer" />
          </label>
          {valid && (
            <p className="hint">
              New balance: {money(Math.max(0, user.balanceCents + cents))}
              {user.balanceCents + cents < 0 && ' — not allowed, the balance cannot go below zero'}
            </p>
          )}
          {error && (
            <p className="banner banner-error" role="alert">
              <Icon name="alert" size={16} />
              {error}
            </p>
          )}
          <button type="submit" className="button button-primary" disabled={!valid || busy || user.balanceCents + cents < 0}>
            {busy && <span className="spinner" />}
            {valid ? `${cents > 0 ? 'Add' : 'Remove'} ${money(Math.abs(cents))}` : 'Adjust'}
          </button>
        </form>
      )}
    </Dialog>
  );
}

function Customers() {
  const { money, user: me, refreshUser } = useSession();
  const { notify, confirm } = useUi();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const load = useCallback(() => api.admin.users(search), [search]);
  const { data, error, reload } = useLoad(load);
  const [crediting, setCrediting] = useState<AdminUserRow>();

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const toggle = async (user: AdminUserRow) => {
    const disabling = !user.disabled;
    if (disabling) {
      const ok = await confirm({
        title: `Disable ${user.email}?`,
        confirmLabel: 'Disable account',
        danger: true,
        body: <p>They are logged out everywhere and can't log in or generate. Their balance and videos are kept; you can enable the account again later.</p>,
      });
      if (!ok) return;
    }
    try {
      await api.admin.disable(user.id, disabling);
      notify(disabling ? 'Account disabled' : 'Account enabled', 'success');
      await reload();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  return (
    <>
      <label className="search">
        <Icon name="search" size={16} />
        <input className="input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by email or name" aria-label="Search customers" />
      </label>
      {!data ? (
        <Loading error={error} />
      ) : data.length === 0 ? (
        <p className="muted">No customers found.</p>
      ) : (
        <div className="table-wrap card card-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Joined</th>
                <th className="num">Balance</th>
                <th className="num">Paid</th>
                <th className="num">Videos</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((user) => (
                <tr key={user.id} className={user.disabled ? 'is-disabled' : undefined}>
                  <td>
                    <strong>{user.email}</strong>
                    <span className="cell-sub">
                      {user.name || '—'}
                      {user.isAdmin && <span className="badge badge-info">Admin</span>}
                      {user.disabled && <span className="badge badge-danger">Disabled</span>}
                    </span>
                  </td>
                  <td className="nowrap">{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td className="num">{money(user.balanceCents)}</td>
                  <td className="num">{money(user.spentCents)}</td>
                  <td className="num">{formatNumber(user.videos)}</td>
                  <td className="row-actions">
                    <button type="button" className="button button-small" onClick={() => setCrediting(user)}>
                      <Icon name="wallet" size={14} />
                      Credit
                    </button>
                    {user.id !== me?.id && (
                      <button type="button" className="button button-small button-ghost" onClick={() => void toggle(user)}>
                        {user.disabled ? 'Enable' : 'Disable'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CreditDialog
        user={crediting}
        onClose={() => setCrediting(undefined)}
        onDone={() => {
          if (crediting?.id === me?.id) void refreshUser();
          setCrediting(undefined);
          void reload();
        }}
      />
    </>
  );
}

function Videos() {
  const { money } = useSession();
  const { notify, confirm } = useUi();
  const { data, error, reload } = useLoad(api.admin.jobs);
  const [filter, setFilter] = useState<'all' | 'problems' | 'active'>('all');

  useEffect(() => {
    const timer = setInterval(() => void reload(), 10_000);
    return () => clearInterval(timer);
  }, [reload]);

  const refund = async (job: AdminJobRow) => {
    const ok = await confirm({
      title: `Refund ${money(job.priceCents)} to ${job.userEmail}?`,
      confirmLabel: 'Refund',
      body: <p>The charge for this video goes back to the customer's balance. A video can only be refunded once.</p>,
    });
    if (!ok) return;
    try {
      const result = await api.admin.refund(job.id);
      notify(result.refunded ? 'Refunded' : 'This video was already refunded', result.refunded ? 'success' : 'info');
      await reload();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const shown = data?.filter((job) =>
    filter === 'all' ? true : filter === 'active' ? ACTIVE_STATUSES.includes(job.status) : ['failed', 'nsfw', 'error'].includes(job.status),
  );

  return (
    <>
      <div className="filters" role="group" aria-label="Filter videos">
        {(
          [
            ['all', 'All'],
            ['active', 'Running'],
            ['problems', 'Failed or moderated'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={filter === id ? 'filter is-active' : 'filter'} aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>
      {!shown ? (
        <Loading error={error} />
      ) : shown.length === 0 ? (
        <p className="muted">No videos here.</p>
      ) : (
        <div className="table-wrap card card-flush">
          <table className="table">
            <thead>
              <tr>
                <th>Video</th>
                <th>Customer</th>
                <th>Status</th>
                <th className="num">Price</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((job) => (
                <tr key={job.id}>
                  <td className="cell-wide">
                    <strong className="clamp-2" title={job.promptPreview}>
                      {job.title ?? job.promptPreview}
                    </strong>
                    <span className="cell-sub">
                      {formatDate(job.createdAt)} · {job.settings.duration}s · {job.settings.resolution} · {job.media.mode}
                      {job.requestId && (
                        <>
                          {' · '}
                          <code title="Higgsfield request ID">{job.requestId.slice(0, 8)}</code>
                        </>
                      )}
                    </span>
                    {(job.detail || job.error) && job.status !== 'completed' && <span className="cell-error">{job.detail ?? job.error}</span>}
                  </td>
                  <td>{job.userEmail}</td>
                  <td>
                    <span className={`badge badge-${STATUS_TONE[job.status]}`}>{STATUS_LABEL[job.status]}</span>
                    {job.refunded && <span className="badge badge-neutral">Refunded</span>}
                  </td>
                  <td className={job.refunded ? 'num is-struck' : 'num'}>{money(job.priceCents)}</td>
                  <td className="row-actions">
                    {job.videoUrl && (
                      <a className="button button-small button-ghost" href={job.videoUrl} target="_blank" rel="noreferrer">
                        <Icon name="external" size={14} />
                        Open
                      </a>
                    )}
                    {!job.refunded && job.priceCents > 0 && !ACTIVE_STATUSES.includes(job.status) && (
                      <button type="button" className="button button-small button-ghost" onClick={() => void refund(job)}>
                        Refund
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Payments() {
  const { money } = useSession();
  const { data, error } = useLoad(api.admin.payments);
  if (!data) return <Loading error={error} />;
  if (data.length === 0) return <p className="muted">No payments yet.</p>;
  return (
    <div className="table-wrap card card-flush">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Customer</th>
            <th>Provider</th>
            <th>Status</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.map((payment: PaymentRecord) => (
            <tr key={payment.id}>
              <td className="nowrap">{formatDate(payment.paidAt ?? payment.createdAt)}</td>
              <td>{payment.userEmail}</td>
              <td className="capitalize">{payment.provider}</td>
              <td>
                <PaymentStatusBadge status={payment.status} />
              </td>
              <td className="num">{money(payment.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const toUnits = (cents: number) => (cents / 100).toFixed(2);
const toCents = (units: string) => Math.round(Number(units) * 100);

function PricingForm() {
  const { money, refreshConfig } = useSession();
  const { notify } = useUi();
  const { data, error, reload } = useLoad(api.admin.settings);
  const [form, setForm] = useState<{ '480p': string; '720p': string; packs: string; bonus: string }>();
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string>();

  useEffect(() => {
    if (!data) return;
    const p = data.pricing;
    setForm({
      '480p': toUnits(p.perSecondCents['480p']),
      '720p': toUnits(p.perSecondCents['720p']),
      packs: p.packsCents.map(toUnits).join(', '),
      bonus: toUnits(p.signupBonusCents),
    });
  }, [data]);

  if (!data || !form) return <Loading error={error} />;
  const draft: Pricing = {
    currency: data.pricing.currency,
    perSecondCents: { '480p': toCents(form['480p']), '720p': toCents(form['720p']) },
    packsCents: form.packs
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(toCents),
    signupBonusCents: toCents(form.bonus || '0'),
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setFormError(undefined);
    try {
      await api.admin.saveSettings(draft);
      await Promise.all([reload(), refreshConfig()]);
      notify('Prices saved. New videos use them right away.', 'success');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card form pricing-form" onSubmit={(e) => void save(e)}>
      <div className="form-grid">
        {RESOLUTIONS.map((resolution) => (
          <label key={resolution} className="form-field">
            <span>
              Price per second, {resolution} ({draft.currency})
            </span>
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form[resolution]}
              onChange={(e) => setForm({ ...form, [resolution]: e.target.value })}
              required
            />
            <small className="hint">30-second video: {money(videoPriceCents({ duration: 30, resolution }, draft))}</small>
          </label>
        ))}
        <label className="form-field">
          <span>Credit packs ({draft.currency}, comma separated)</span>
          <input className="input" value={form.packs} onChange={(e) => setForm({ ...form, packs: e.target.value })} required />
          <small className="hint">{draft.packsCents.map((c) => money(c)).join(' · ')}</small>
        </label>
        <label className="form-field">
          <span>Free credit for new accounts ({draft.currency})</span>
          <input className="input" type="number" min="0" step="0.01" inputMode="decimal" value={form.bonus} onChange={(e) => setForm({ ...form, bonus: e.target.value })} />
          <small className="hint">0 turns it off. Free credit costs you real generation money.</small>
        </label>
      </div>
      <p className="hint">
        Payments: <strong className="capitalize">{data.paymentProvider}</strong>. Currency is set with the <code>CURRENCY</code> setting on the server. Price
        changes apply to new videos only; customers who have the studio open are asked to confirm the new price.
      </p>
      {formError && (
        <p className="banner banner-error" role="alert">
          <Icon name="alert" size={16} />
          {formError}
        </p>
      )}
      <div>
        <button type="submit" className="button button-primary" disabled={saving}>
          {saving && <span className="spinner" />}
          Save prices
        </button>
      </div>
    </form>
  );
}

export function Admin() {
  const { query } = useLocation();
  const requested = query.get('tab') as Tab | null;
  const tab: Tab = TABS.some((t) => t.id === requested) ? requested! : 'overview';

  return (
    <div className="app">
      <SiteHeader />
      <main className="page page-wide">
        <header className="page-head">
          <h1>Admin</h1>
          <nav className="subnav" aria-label="Admin sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={tab === t.id ? 'subnav-link is-active' : 'subnav-link'}
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => navigate(t.id === 'overview' ? '/admin' : `/admin?tab=${t.id}`, { replace: true })}
              >
                <Icon name={t.icon} size={16} />
                {t.label}
              </button>
            ))}
          </nav>
        </header>
        {tab === 'overview' && <Overview />}
        {tab === 'customers' && <Customers />}
        {tab === 'videos' && <Videos />}
        {tab === 'payments' && <Payments />}
        {tab === 'pricing' && <PricingForm />}
      </main>
      <SiteFooter />
    </div>
  );
}
