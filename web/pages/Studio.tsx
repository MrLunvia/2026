/** The paid studio: a create panel (model, prompts, media, presets, price) beside a gallery of the customer's videos. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MODELS, endpointFor, inputLabel, modelById, qualityOf, type InputType } from '../../shared/models.ts';
import { presetIn, type PresetFamily } from '../../shared/presets.ts';
import { mediaCounts, perSecondCents, quote } from '../../shared/pricing.ts';
import { countWords } from '../../shared/text.ts';
import { ACTIVE_STATUSES } from '../../shared/types.ts';
import { ApiError, api } from '../api.ts';
import { buildRequest, countsOf, promptProblems, takePendingPrompt, useComposer } from '../composer.ts';
import { BuyCreditsDialog } from '../components/BuyCredits.tsx';
import { SiteHeader } from '../components/Chrome.tsx';
import { Gallery, type JobActions } from '../components/Gallery.tsx';
import { Icon } from '../components/Icon.tsx';
import { PresetPicker } from '../components/PresetPicker.tsx';
import { PromptCard } from '../components/PromptCard.tsx';
import { ModelSection, OutputSettings } from '../components/SettingsPanel.tsx';
import { SplitDialog } from '../components/SplitDialog.tsx';
import { VideoViewer } from '../components/VideoViewer.tsx';
import { formatNumber, plural } from '../format.ts';
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
  const [preset, setPreset] = useState<{ promptId: string; family: PresetFamily }>();
  const [viewing, setViewing] = useState<string>();
  const [showProblems, setShowProblems] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [buying, setBuying] = useState(false);
  const [tab, setTab] = useState<'create' | 'jobs'>('create');
  const importInput = useRef<HTMLInputElement>(null);
  const createScroll = useRef<HTMLDivElement>(null);
  const refreshJobs = jobs.refresh;
  const enabled = config.generationEnabled;
  const balance = user.balanceCents;
  const activeCount = jobs.jobs.filter((job) => ACTIVE_STATUSES.includes(job.status)).length;
  const draftReady = draft !== undefined;

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

  // From the home page: a model to try (/app?model=…) and a prompt typed before signing up.
  const disabledModels = config.pricing.disabledModels;
  const wantedModel = query.get('model');
  useEffect(() => {
    if (!draftReady || !wantedModel) return;
    const model = modelById(wantedModel);
    if (model && !disabledModels.includes(model.id)) actions.setSettings({ model: model.id });
    navigate('/app', { replace: true });
  }, [draftReady, wantedModel, disabledModels, actions]);
  useEffect(() => {
    if (!draftReady) return;
    const text = takePendingPrompt();
    if (!text) return;
    actions.addPromptText(text);
    notify('Your prompt is ready. Check the settings and press Generate.', 'success');
  }, [draftReady, actions, notify]);

  // If the owner stops offering the chosen model, move to one that is offered.
  const chosenModel = draft?.settings.model;
  useEffect(() => {
    if (!chosenModel || !disabledModels.includes(chosenModel)) return;
    const next = MODELS.find((m) => !disabledModels.includes(m.id));
    if (!next) return;
    actions.setSettings({ model: next.id });
    notify(`${modelById(chosenModel)?.name ?? 'That model'} isn't offered right now, so the studio switched to ${next.name}.`, 'info');
  }, [chosenModel, disabledModels, actions, notify]);

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
    let total = 0;
    let seconds = 0;
    const modes = new Map<InputType, number>();
    const prices = new Map<string, number>();
    const problems: { id: string; index: number; messages: string[] }[] = [];
    draft.prompts.forEach((prompt, index) => {
      const count = countWords(prompt.text);
      words += count;
      modes.set(prompt.mode, (modes.get(prompt.mode) ?? 0) + 1);
      const messages = promptProblems(prompt, draft.settings, count);
      if (messages.length > 0) problems.push({ id: prompt.id, index, messages });
      const q = quote(config.pricing, draft.settings, countsOf(prompt, endpointFor(draft.settings, prompt.mode)), prompt.text);
      if (q.cents !== undefined) {
        prices.set(prompt.id, q.cents);
        total += q.cents;
        seconds += q.seconds;
      }
    });
    return { words, modes, problems, prices, total, seconds, count: draft.prompts.length };
  }, [draft, config.pricing]);

  const model = draft ? modelById(draft.settings.model) : undefined;
  const quality = model && draft ? qualityOf(model, draft.settings.quality) : undefined;
  const rate = draft ? perSecondCents(config.pricing, draft.settings.model, draft.settings.quality) : undefined;
  const total = stats?.total ?? 0;
  const samePrice = stats && new Set(stats.prices.values()).size === 1 && stats.prices.size === stats.count;
  const affordable = total <= balance;
  const tooMany = (stats?.count ?? 0) > config.limits.maxPromptsPerRequest;

  const showPrompt = useCallback((id: string) => {
    setTab('create');
    requestAnimationFrame(() => document.getElementById(`prompt-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }, []);

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
      showPrompt(stats.problems[0]!.id);
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
              <dt>Model</dt>
              <dd>
                {model?.name} · {quality?.label}
              </dd>
            </div>
            <div>
              <dt>Videos</dt>
              <dd>{formatNumber(n)}</dd>
            </div>
            <div>
              <dt>{samePrice ? 'Price each' : 'Billed seconds'}</dt>
              <dd>{samePrice ? money(total / n) : `${formatNumber(stats.seconds)} s`}</dd>
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
                {settings.aspectRatio === 'auto' ? 'Auto' : settings.aspectRatio} · {settings.generateAudio ? 'on' : 'off'}
              </dd>
            </div>
          </dl>
          <p className="summary-modes">
            {formatNumber(stats.seconds)} billed seconds at {rate !== undefined ? money(rate) : '—'} a second ·{' '}
            {[...stats.modes]
              .map(([mode, count]) => `${formatNumber(count)} × ${model ? inputLabel(model, mode).toLowerCase() : mode}`)
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
      const created = await api.createJobs({ ...buildRequest(draft), expectedTotalCents: total });
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
  }, [draft, stats, submitting, enabled, tooMany, affordable, total, balance, model, quality, rate, samePrice, money, config.limits, confirm, notify, setUser, refreshJobs, refreshConfig, refreshUser, showPrompt]);

  // Stable handler for the memoized prompt cards; always runs the latest generate().
  const generateRef = useRef(generate);
  useLayoutEffect(() => {
    generateRef.current = generate;
  }, [generate]);
  const onGenerate = useCallback(() => void generateRef.current(), []);
  const onPreset = useCallback((promptId: string, family: PresetFamily) => setPreset({ promptId, family }), []);

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
      remove: async (id) => {
        const job = jobList.find((j) => j.id === id);
        const ok = await confirm({
          title: 'Delete this video?',
          body: <p>It is removed from My videos.{job?.status === 'completed' ? ' Download it first if you want to keep a copy.' : ''}</p>,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        setViewing((current) => (current === id ? undefined : current));
        await attempt(() => api.remove(id), 'Deleted');
      },
      retry: async (id) => {
        const job = jobList.find((j) => j.id === id);
        if (!job) return;
        const cost = quote(config.pricing, job.settings, mediaCounts(job.media), job.promptPreview).cents;
        if (cost === undefined) {
          notify('This model or setting isn’t available any more. Use Reuse to load it and pick another.', 'error');
          return;
        }
        const ok = await confirm({
          title: `Try again for ${money(cost)}?`,
          confirmLabel: `Pay ${money(cost)} and retry`,
          body: <p>This makes a new video with the same prompt, media and settings, and deducts {money(cost)} from your balance.</p>,
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
          setViewing(undefined);
          setTab('create');
          createScroll.current?.scrollTo({ top: 0, behavior: 'smooth' });
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
      ...(user.isAdmin
        ? {
            feature: (id: string, featured: boolean) =>
              attempt(() => api.admin.feature(id, featured), featured ? 'Now showing on the home page' : 'Removed from the home page'),
          }
        : {}),
    };
  }, [actions, confirm, notify, refreshJobs, setUser, jobList, config.pricing, money, user.isAdmin]);

  const onInspire = useCallback(
    (text: string) => {
      actions.addPromptText(text);
      setTab('create');
      notify('Example added to your prompts. Edit it, then press Generate.', 'success');
    },
    [actions, notify],
  );

  const viewingIndex = viewing ? jobList.findIndex((job) => job.id === viewing) : -1;
  const viewingJob = viewingIndex >= 0 ? jobList[viewingIndex] : undefined;
  const neighbors = { previous: jobList[viewingIndex - 1]?.id, next: viewingIndex >= 0 ? jobList[viewingIndex + 1]?.id : undefined };
  const splitPrompt = draft?.prompts.find((p) => p.id === splitId);
  const presetPrompt = draft?.prompts.find((p) => p.id === preset?.promptId);

  return (
    <div className="app app-studio">
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

      <div className="studio" data-tab={tab}>
        <section className="create-panel" aria-label="Create videos">
          <div className="create-scroll" ref={createScroll}>
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
              <div className="loading">
                <span className="spinner" /> Loading your draft…
              </div>
            ) : (
              <>
                <ModelSection
                  settings={draft.settings}
                  onChange={actions.setSettings}
                  pricing={config.pricing}
                  money={money}
                  hint={rate !== undefined ? `${money(rate)} per second of video` : 'Not available right now'}
                />

                <div className="prompts-toolbar">
                  <h2>
                    {stats.count === 1 ? 'Prompt' : 'Prompts'}
                    {stats.count > 1 && <span className="count">{formatNumber(stats.count)}</span>}
                  </h2>
                  <div className="toolbar-actions">
                    <button type="button" className="button button-small button-ghost" onClick={() => importInput.current?.click()} title="Each file becomes a prompt">
                      <Icon name="file" size={15} />
                      Import .txt
                    </button>
                    <button type="button" className="button button-small button-ghost" onClick={actions.clearAll}>
                      <Icon name="trash" size={15} />
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
                      total={stats.count}
                      settings={draft.settings}
                      price={stats.prices.has(prompt.id) ? money(stats.prices.get(prompt.id)!) : undefined}
                      showProblems={showProblems}
                      uploadsEnabled={enabled}
                      actions={actions}
                      onSplit={setSplitId}
                      onPreset={onPreset}
                      onGenerate={onGenerate}
                    />
                  ))}
                </div>

                <button type="button" className="add-prompt" onClick={actions.addPrompt}>
                  <Icon name="plus" size={16} />
                  Add another prompt
                  <span className="muted">· one video each</span>
                </button>
              </>
            )}
          </div>

          {draft && stats && (
            <footer className="composer-footer">
              <OutputSettings settings={draft.settings} onChange={actions.setSettings} pricing={config.pricing} money={money} />
              <div className="footer-summary">
                <strong>
                  {samePrice ? `${plural(stats.count, 'video')} × ${money(total / stats.count)} = ${money(total)}` : `${plural(stats.count, 'video')} = ${money(total)}`}
                </strong>
                <span className="muted">
                  {model?.name} · {quality?.label} · {formatNumber(stats.seconds)} s billed · balance {money(balance)}
                  {saveFailed ? ' · draft too large to autosave' : ''}
                </span>
                {showProblems && stats.problems.length > 0 && (
                  <button type="button" className="link-button is-danger" onClick={() => showPrompt(stats.problems[0]!.id)}>
                    <Icon name="alert" size={14} />
                    {plural(stats.problems.length, 'prompt needs', 'prompts need')} attention
                  </button>
                )}
              </div>
              {affordable || !enabled ? (
                <button type="button" className="button button-primary button-generate" disabled={!enabled || submitting || tooMany} onClick={() => void generate()}>
                  {submitting ? <span className="spinner" /> : <Icon name="sparkles" size={18} />}
                  {submitting ? 'Starting…' : `Generate ${stats.count === 1 ? 'video' : `${formatNumber(stats.count)} videos`} · ${money(total)}`}
                </button>
              ) : (
                <button type="button" className="button button-primary button-generate" onClick={() => setBuying(true)}>
                  <Icon name="wallet" size={18} />
                  Add {money(total - balance)} credit to generate
                </button>
              )}
            </footer>
          )}
        </section>

        <section className="gallery-pane" aria-label="My videos">
          <Gallery
            jobs={jobs.jobs}
            loaded={jobs.loaded}
            error={jobs.error}
            now={now}
            actions={jobActions}
            money={money}
            onOpen={setViewing}
            onInspire={onInspire}
          />
        </section>
      </div>

      <VideoViewer
        job={viewingJob}
        neighbors={neighbors}
        now={now}
        actions={jobActions}
        money={money}
        onNavigate={setViewing}
        onClose={() => setViewing(undefined)}
      />
      <PresetPicker
        family={preset && presetPrompt ? preset.family : undefined}
        current={preset && presetPrompt ? presetIn(presetPrompt.text, preset.family)?.id : undefined}
        prompts={stats?.count ?? 1}
        onClose={() => setPreset(undefined)}
        onPick={(chosen, everyPrompt) => {
          if (preset) actions.setPreset(everyPrompt ? undefined : preset.promptId, preset.family, chosen);
          setPreset(undefined);
        }}
      />
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
