/** The paid studio: write prompts, add images, see the price, generate, and watch results. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MODEL_LABEL } from '../../shared/options.ts';
import { videoPriceCents } from '../../shared/pricing.ts';
import { countWords } from '../../shared/text.ts';
import { ACTIVE_STATUSES } from '../../shared/types.ts';
import { ApiError, api } from '../api.ts';
import { buildRequest, promptProblems, useComposer } from '../composer.ts';
import { BuyCreditsDialog } from '../components/BuyCredits.tsx';
import { SiteHeader } from '../components/Chrome.tsx';
import { Icon } from '../components/Icon.tsx';
import { JobsPanel, type JobActions } from '../components/JobsPanel.tsx';
import { PromptCard } from '../components/PromptCard.tsx';
import { SettingsPanel } from '../components/SettingsPanel.tsx';
import { SplitDialog } from '../components/SplitDialog.tsx';
import { formatElapsed, formatNumber, plural } from '../format.ts';
import { useJobs, useNow } from '../jobs.ts';
import { navigate, useLocation } from '../router.tsx';
import { useSession } from '../session.tsx';
import { useUi } from '../ui.tsx';

export function Studio() {
  const { config: maybeConfig, user: maybeUser, setUser, money, refreshConfig, refreshUser } = useSession();
  const config = maybeConfig!;
  const user = maybeUser!;
  const { notify, confirm } = useUi();
  const { draft, saveFailed, actions } = useComposer(notify, `adron-video-engine/draft/v1/${user.id}`);
  const jobs = useJobs();
  const now = useNow(jobs.hasActive);
  const { query } = useLocation();
  const [splitId, setSplitId] = useState<string>();
  const [showProblems, setShowProblems] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [buying, setBuying] = useState(false);
  const [tab, setTab] = useState<'create' | 'jobs'>('create');
  const importInput = useRef<HTMLInputElement>(null);
  const refreshJobs = jobs.refresh;
  const enabled = config.generationEnabled;
  const balance = user.balanceCents;
  const activeCount = jobs.jobs.filter((job) => ACTIVE_STATUSES.includes(job.status)).length;

  // Back from Stripe checkout: confirm the payment, then tidy the URL.
  const paymentState = query.get('payment');
  const sessionId = query.get('session_id');
  useEffect(() => {
    if (!paymentState) return;
    let cancelled = false;
    void (async () => {
      if (paymentState === 'success' && sessionId) {
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const result = await api.confirmStripe(sessionId);
            if (cancelled) return;
            if (result.status === 'paid') {
              setUser(result.user);
              notify('Payment received. Your credit is ready.', 'success');
              break;
            }
          } catch (error) {
            if (!cancelled) notify((error as Error).message, 'error');
            break;
          }
          if (attempt === 4) notify('Your payment is still processing; your balance will update shortly.', 'info');
          else await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
      } else if (paymentState === 'canceled') {
        notify('Payment canceled. You were not charged.', 'info');
      }
      if (!cancelled) navigate('/app', { replace: true });
    })();
    return () => {
      cancelled = true;
    };
  }, [paymentState, sessionId, setUser, notify]);

  // Refunds happen on the server; refresh the balance when one shows up.
  const refunded = jobs.jobs.filter((job) => job.refunded).length;
  const lastRefunded = useRef(refunded);
  useEffect(() => {
    if (refunded > lastRefunded.current) void refreshUser();
    lastRefunded.current = refunded;
  }, [refunded, refreshUser]);

  const stats = useMemo(() => {
    if (!draft) return undefined;
    let words = 0;
    const modes = { text: 0, frames: 0, references: 0 };
    const problems: { id: string; index: number; messages: string[] }[] = [];
    draft.prompts.forEach((prompt, index) => {
      const count = countWords(prompt.text);
      words += count;
      modes[prompt.mode]++;
      const messages = promptProblems(prompt, count);
      if (messages.length > 0) problems.push({ id: prompt.id, index, messages });
    });
    return { words, modes, problems, count: draft.prompts.length };
  }, [draft]);

  const price = draft ? videoPriceCents(draft.settings, config.pricing) : 0;
  const total = stats ? price * stats.count : 0;
  const affordable = total <= balance;
  const tooMany = (stats?.count ?? 0) > config.limits.maxPromptsPerRequest;

  const generate = useCallback(async () => {
    if (!draft || !stats || submitting) return;
    if (!enabled) {
      notify('Video generation is temporarily unavailable. Please try again later.', 'error');
      return;
    }
    if (tooMany) {
      notify(`At most ${formatNumber(config.limits.maxPromptsPerRequest)} videos per batch. Split it into smaller batches.`, 'error');
      return;
    }
    if (stats.problems.length > 0) {
      setShowProblems(true);
      setTab('create');
      document.getElementById(`prompt-${stats.problems[0]!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      notify(`${plural(stats.problems.length, 'prompt needs', 'prompts need')} attention first`, 'error');
      return;
    }
    if (!affordable) {
      notify(`You need ${money(total - balance)} more credit for this batch.`, 'error');
      setBuying(true);
      return;
    }
    const { settings } = draft;
    const n = stats.count;
    const ok = await confirm({
      title: n === 1 ? `Generate 1 video for ${money(total)}?` : `Generate ${formatNumber(n)} videos for ${money(total)}?`,
      confirmLabel: `Pay ${money(total)} and generate`,
      acknowledge: n > 10 ? `I understand ${money(total)} will be deducted for ${formatNumber(n)} videos` : undefined,
      body: (
        <div className="summary">
          <dl className="summary-grid">
            <div>
              <dt>Videos</dt>
              <dd>{formatNumber(n)}</dd>
            </div>
            <div>
              <dt>Each</dt>
              <dd>
                {settings.duration}s · {settings.resolution}
              </dd>
            </div>
            <div>
              <dt>Price each</dt>
              <dd>{money(price)}</dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{money(total)}</dd>
            </div>
            <div>
              <dt>Balance after</dt>
              <dd>{money(balance - total)}</dd>
            </div>
            <div>
              <dt>Aspect · audio</dt>
              <dd>
                {stats.modes.frames === n ? 'From image' : settings.aspectRatio} · {settings.generateAudio ? 'on' : 'off'}
              </dd>
            </div>
          </dl>
          <p className="summary-modes">
            {formatElapsed(n * settings.duration * 1000)} of video ·{' '}
            {(
              [
                [stats.modes.text, 'text-to-video'],
                [stats.modes.frames, 'image-to-video'],
                [stats.modes.references, 'reference-to-video'],
              ] as const
            )
              .filter(([count]) => count > 0)
              .map(([count, label]) => `${formatNumber(count)} ${label}`)
              .join(' · ')}
          </p>
          <p className="note">
            <Icon name="wallet" size={16} />
            The total is deducted from your balance now. Any video that fails or is blocked by the content filter is refunded
            automatically. Videos that haven't started yet can be canceled for a full refund.
          </p>
        </div>
      ),
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      const created = await api.createJobs({ ...buildRequest(draft), expectedPriceCents: price });
      setUser(created.user);
      notify(`Started ${plural(created.jobs.length, 'video')} · ${money(total)} deducted`, 'success');
      setShowProblems(false);
      setTab('jobs');
      await refreshJobs();
    } catch (error) {
      notify((error as Error).message, 'error');
      if (error instanceof ApiError && error.status === 409) void refreshConfig();
      if (error instanceof ApiError && error.status === 402) {
        void refreshUser();
        setBuying(true);
      }
    } finally {
      setSubmitting(false);
    }
  }, [draft, stats, submitting, enabled, tooMany, affordable, total, balance, price, money, config.limits, confirm, notify, setUser, refreshJobs, refreshConfig, refreshUser]);

  // Stable handler for the memoized prompt cards; always runs the latest generate().
  const generateRef = useRef(generate);
  useLayoutEffect(() => {
    generateRef.current = generate;
  }, [generate]);
  const onGenerate = useCallback(() => void generateRef.current(), []);

  const jobList = jobs.jobs;
  const jobActions: JobActions = useMemo(() => {
    const attempt = async (action: () => Promise<unknown>, success?: string) => {
      try {
        await action();
        if (success) notify(success, 'success');
      } catch (error) {
        notify((error as Error).message, 'error');
      }
      await refreshJobs();
    };
    return {
      cancel: (id) =>
        attempt(async () => {
          const result = await api.cancel(id);
          setUser(result.user);
        }, 'Canceled and refunded'),
      refresh: (id) => attempt(() => api.refresh(id)),
      remove: (id) => attempt(() => api.remove(id)),
      retry: async (id) => {
        const job = jobList.find((j) => j.id === id);
        if (!job) return;
        const cost = videoPriceCents(job.settings, config.pricing);
        const ok = await confirm({
          title: `Try again for ${money(cost)}?`,
          confirmLabel: `Pay ${money(cost)} and retry`,
          body: <p>This makes a new video with the same prompt, images and settings, and deducts {money(cost)} from your balance.</p>,
        });
        if (!ok) return;
        await attempt(async () => {
          const result = await api.retry(id, cost);
          setUser(result.user);
        }, 'Started again');
      },
      reuse: async (id) => {
        try {
          actions.loadJob(await api.job(id));
          setTab('create');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (error) {
          notify((error as Error).message, 'error');
        }
      },
      fullPrompt: async (id) => {
        try {
          return (await api.job(id)).prompt;
        } catch (error) {
          notify((error as Error).message, 'error');
          throw error;
        }
      },
      copy: async (text, what) => {
        try {
          await navigator.clipboard.writeText(text);
          notify(`${what} copied`, 'success');
        } catch {
          notify('Could not copy to the clipboard', 'error');
        }
      },
    };
  }, [actions, confirm, notify, refreshJobs, setUser, jobList, config.pricing, money]);

  const splitPrompt = draft?.prompts.find((p) => p.id === splitId);

  return (
    <div className="app">
      <SiteHeader running={activeCount} />

      <nav className="tabs" aria-label="Sections">
        <button type="button" aria-pressed={tab === 'create'} onClick={() => setTab('create')}>
          <Icon name="sparkles" size={16} />
          Create
        </button>
        <button type="button" aria-pressed={tab === 'jobs'} onClick={() => setTab('jobs')}>
          <Icon name="film" size={16} />
          My videos
          {activeCount > 0 && <span className="count">{activeCount}</span>}
        </button>
      </nav>

      <main className="layout" data-tab={tab}>
        <section className="pane pane-create" aria-label="Create videos">
          {!enabled && (
            <div className="banner banner-warning">
              <Icon name="alert" size={16} />
              <div>
                <strong>Video generation is temporarily unavailable.</strong>
                <p>
                  You can still write and save prompts; your draft is kept on this device.
                  {user.isAdmin && ' (Admin: set HF_CREDENTIALS on the server and restart it.)'}
                </p>
              </div>
            </div>
          )}

          {!draft || !stats ? (
            <div className="card loading">
              <span className="spinner" /> Loading your draft…
            </div>
          ) : (
            <>
              <SettingsPanel
                settings={draft.settings}
                onChange={actions.setSettings}
                framesCount={stats.modes.frames}
                hint={`${MODEL_LABEL} · ${money(price)} per video at these settings`}
              />

              <div className="prompts-toolbar">
                <h2>
                  Prompts <span className="count">{formatNumber(stats.count)}</span>
                </h2>
                <div className="toolbar-actions">
                  <button type="button" className="button button-small button-ghost" onClick={() => importInput.current?.click()}>
                    <Icon name="file" size={16} />
                    Import .txt files
                  </button>
                  <button type="button" className="button button-small button-ghost" onClick={actions.clearAll}>
                    <Icon name="trash" size={16} />
                    Clear all
                  </button>
                  <input
                    ref={importInput}
                    type="file"
                    hidden
                    multiple
                    accept=".txt,.md,.markdown,.fountain,text/plain,text/markdown"
                    onChange={(e) => {
                      const files = [...(e.target.files ?? [])];
                      e.target.value = '';
                      if (files.length > 0) void actions.importTextFiles(files);
                    }}
                  />
                </div>
              </div>

              <div className="prompt-list">
                {draft.prompts.map((prompt, index) => (
                  <PromptCard
                    key={prompt.id}
                    prompt={prompt}
                    index={index}
                    showProblems={showProblems}
                    uploadsEnabled={enabled}
                    actions={actions}
                    onSplit={setSplitId}
                    onGenerate={onGenerate}
                  />
                ))}
              </div>

              <button type="button" className="add-prompt" onClick={actions.addPrompt}>
                <Icon name="plus" />
                Add another prompt
              </button>

              <footer className="composer-footer">
                <div className="footer-summary">
                  <strong>
                    {plural(stats.count, 'video')} × {money(price)} = {money(total)}
                  </strong>
                  <span className="muted">
                    {draft.settings.duration}s · {draft.settings.resolution} · balance {money(balance)}
                    {saveFailed ? ' · draft too large to autosave' : ''}
                  </span>
                  {showProblems && stats.problems.length > 0 && (
                    <button
                      type="button"
                      className="link-button is-danger"
                      onClick={() => document.getElementById(`prompt-${stats.problems[0]!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                    >
                      <Icon name="alert" size={14} />
                      {plural(stats.problems.length, 'prompt needs', 'prompts need')} attention
                    </button>
                  )}
                </div>
                {affordable || !enabled ? (
                  <button type="button" className="button button-primary button-large" disabled={!enabled || submitting || tooMany} onClick={() => void generate()}>
                    {submitting ? <span className="spinner" /> : <Icon name="play" size={16} />}
                    {submitting ? 'Starting…' : `Generate ${stats.count === 1 ? 'video' : `${formatNumber(stats.count)} videos`} · ${money(total)}`}
                  </button>
                ) : (
                  <button type="button" className="button button-primary button-large" onClick={() => setBuying(true)}>
                    <Icon name="wallet" size={16} />
                    Add {money(total - balance)} credit to generate
                  </button>
                )}
              </footer>
            </>
          )}
        </section>

        <aside className="pane pane-jobs" aria-label="My videos">
          <JobsPanel jobs={jobs.jobs} loaded={jobs.loaded} error={jobs.error} now={now} actions={jobActions} money={money} />
        </aside>
      </main>

      <SplitDialog
        prompt={splitPrompt}
        duration={draft?.settings.duration ?? 5}
        otherPrompts={(draft?.prompts.length ?? 1) - 1}
        onClose={() => setSplitId(undefined)}
        onApply={(scenes, options) => {
          if (splitId) actions.replaceWithScenes(splitId, scenes, options);
          setSplitId(undefined);
        }}
      />
      <BuyCreditsDialog open={buying} onClose={() => setBuying(false)} />
    </div>
  );
}
