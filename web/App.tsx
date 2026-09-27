import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { LIMITS, MODEL_LABEL } from '../shared/options.ts';
import { countWords } from '../shared/text.ts';
import { ACTIVE_STATUSES, type AppConfig } from '../shared/types.ts';
import { api } from './api.ts';
import { buildRequest, promptProblems, useComposer, type Notify } from './composer.ts';
import { Dialog } from './components/Dialog.tsx';
import { Icon } from './components/Icon.tsx';
import { JobsPanel, type JobActions } from './components/JobsPanel.tsx';
import { PromptCard } from './components/PromptCard.tsx';
import { SettingsPanel } from './components/SettingsPanel.tsx';
import { SplitDialog } from './components/SplitDialog.tsx';
import { formatElapsed, formatNumber, plural, uid } from './format.ts';
import { useJobs, useNow } from './jobs.ts';

interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'error';
}

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const dismiss = useCallback((id: string) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const notify: Notify = useCallback(
    (message, tone = 'info') => {
      const id = uid();
      setToasts((all) => [...all.slice(-3), { id, message, tone }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 8_000 : 4_000);
    },
    [dismiss],
  );
  return { toasts, notify, dismiss };
}

interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** When set, a checkbox with this text must be ticked first (large paid batches). */
  acknowledge?: string;
}

function ConfirmDialog({ request, onDone }: { request: ConfirmRequest; onDone: (ok: boolean) => void }) {
  const [acknowledged, setAcknowledged] = useState(!request.acknowledge);
  return (
    <Dialog
      open
      title={request.title}
      onClose={() => onDone(false)}
      footer={
        <>
          <button type="button" className="button button-ghost" onClick={() => onDone(false)}>
            Cancel
          </button>
          <button type="button" className="button button-primary" disabled={!acknowledged} onClick={() => onDone(true)}>
            {request.confirmLabel}
          </button>
        </>
      }
    >
      {request.body}
      {request.acknowledge && (
        <label className="checkbox acknowledge">
          <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
          {request.acknowledge}
        </label>
      )}
    </Dialog>
  );
}

function useConfirm() {
  const [pending, setPending] = useState<ConfirmRequest & { resolve: (ok: boolean) => void }>();
  const confirm = useCallback((request: ConfirmRequest) => new Promise<boolean>((resolve) => setPending({ ...request, resolve })), []);
  const dialog = pending && (
    <ConfirmDialog
      request={pending}
      onDone={(ok) => {
        pending.resolve(ok);
        setPending(undefined);
      }}
    />
  );
  return { confirm, dialog };
}

export function App() {
  const { toasts, notify, dismiss } = useToasts();
  const { draft, saveFailed, actions } = useComposer(notify);
  const jobs = useJobs();
  const now = useNow(jobs.hasActive);
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [config, setConfig] = useState<AppConfig>();
  const [configError, setConfigError] = useState<string>();
  const [splitId, setSplitId] = useState<string>();
  const [showProblems, setShowProblems] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<'create' | 'jobs'>('create');
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.config().then(setConfig, (e: Error) => setConfigError(e.message));
  }, []);

  const refreshJobs = jobs.refresh;
  const configured = config?.credentialsConfigured === true;
  const activeCount = jobs.jobs.filter((job) => ACTIVE_STATUSES.includes(job.status)).length;

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

  const generate = useCallback(async () => {
    if (!draft || !stats || submitting) return;
    if (!configured) {
      notify('Generation is off until HF_CREDENTIALS is set on the server', 'error');
      return;
    }
    if (stats.count > LIMITS.promptsPerBatch) {
      notify(`At most ${formatNumber(LIMITS.promptsPerBatch)} prompts per batch`, 'error');
      return;
    }
    if (stats.problems.length > 0) {
      setShowProblems(true);
      setTab('create');
      document.getElementById(`prompt-${stats.problems[0]!.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      notify(`${plural(stats.problems.length, 'prompt needs', 'prompts need')} attention first`, 'error');
      return;
    }
    const { settings } = draft;
    const n = stats.count;
    const ok = await confirm({
      title: n === 1 ? 'Start 1 generation?' : `Start ${formatNumber(n)} generations?`,
      confirmLabel: n === 1 ? 'Generate video' : `Generate ${formatNumber(n)} videos`,
      acknowledge: n > 10 ? `I understand this starts ${formatNumber(n)} separate paid generations` : undefined,
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
              <dt>Aspect ratio</dt>
              <dd>{stats.modes.frames === n ? 'From start frames' : settings.aspectRatio}</dd>
            </div>
            <div>
              <dt>Audio</dt>
              <dd>{settings.generateAudio ? 'On' : 'Off'}</dd>
            </div>
            <div>
              <dt>Total video</dt>
              <dd>{formatElapsed(n * settings.duration * 1000)}</dd>
            </div>
            <div>
              <dt>Prompt words</dt>
              <dd>{formatNumber(stats.words)}</dd>
            </div>
          </dl>
          <p className="summary-modes">
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
            <Icon name="alert" size={16} />
            Each video is a separate billable request on your Higgsfield account. Jobs are sent one at a time, and any job that
            hasn't started generating can still be canceled.
          </p>
        </div>
      ),
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      const created = await api.createJobs(buildRequest(draft));
      notify(`Started ${plural(created.length, 'generation')}`, 'success');
      setShowProblems(false);
      setTab('jobs');
      await refreshJobs();
    } catch (error) {
      notify((error as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  }, [draft, stats, submitting, configured, confirm, notify, refreshJobs]);

  // Stable handler for the memoized prompt cards; always runs the latest generate().
  const generateRef = useRef(generate);
  useLayoutEffect(() => {
    generateRef.current = generate;
  }, [generate]);
  const onGenerate = useCallback(() => void generateRef.current(), []);
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
      cancel: (id) => attempt(() => api.cancel(id), 'Canceled'),
      refresh: (id) => attempt(() => api.refresh(id)),
      remove: (id) => attempt(() => api.remove(id)),
      retry: async (id) => {
        const ok = await confirm({
          title: 'Retry this generation?',
          confirmLabel: 'Retry',
          body: <p>This starts a new, separately billed generation with the same prompt, images and settings.</p>,
        });
        if (ok) await attempt(() => api.retry(id), 'Retry started');
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
  }, [actions, confirm, notify, refreshJobs]);

  const splitPrompt = draft?.prompts.find((p) => p.id === splitId);
  const blocked = !configured || submitting || !stats || stats.count > LIMITS.promptsPerBatch;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Icon name="play" size={16} />
          </span>
          <div>
            <h1>Adron Video Engine</h1>
            <p>{MODEL_LABEL} · Higgsfield API</p>
          </div>
        </div>
        <div className="topbar-status">
          {activeCount > 0 && (
            <span className="pill pill-progress">
              <span className="pulse" aria-hidden="true" />
              {formatNumber(activeCount)} running
            </span>
          )}
          <span className={config ? (configured ? 'pill pill-ok' : 'pill pill-warn') : 'pill'}>
            <Icon name="key" size={14} />
            <span className="label-long">
              {config ? (configured ? 'API key configured' : 'API key missing') : configError ? 'Server unreachable' : 'Connecting…'}
            </span>
            <span className="label-short">
              {config ? (configured ? 'Key set' : 'No key') : configError ? 'Offline' : '…'}
            </span>
          </span>
        </div>
      </header>

      <nav className="tabs" aria-label="Sections">
        <button type="button" aria-pressed={tab === 'create'} onClick={() => setTab('create')}>
          <Icon name="sparkles" size={16} />
          Create
        </button>
        <button type="button" aria-pressed={tab === 'jobs'} onClick={() => setTab('jobs')}>
          <Icon name="film" size={16} />
          Generations
          {activeCount > 0 && <span className="count">{activeCount}</span>}
        </button>
      </nav>

      <main className="layout" data-tab={tab}>
        <section className="pane pane-create" aria-label="Create videos">
          {configError && (
            <p className="banner banner-error">
              <Icon name="alert" size={16} />
              Can't reach the app server: {configError}
            </p>
          )}
          {config && !configured && (
            <div className="banner banner-warning">
              <Icon name="key" size={16} />
              <div>
                <strong>Generation is off: no Higgsfield API key on the server.</strong>
                {config.environment === 'codespaces' ? (
                  <p>
                    On GitHub, open Settings → Codespaces → Secrets and add <code>HF_CREDENTIALS</code> with the value{' '}
                    <code>key-id:key-secret</code> for this repository, then stop and restart this codespace. The key stays on the
                    server; this page never sees it. You can still write and organize prompts.
                  </p>
                ) : (
                  <p>
                    Put <code>HF_CREDENTIALS=key-id:key-secret</code> in <code>.env.local</code> and restart the server. The key stays on
                    the server; this page never sees it. You can still write and organize prompts.
                  </p>
                )}
              </div>
            </div>
          )}

          {!draft || !stats ? (
            <div className="card loading">
              <span className="spinner" /> Loading your draft…
            </div>
          ) : (
            <>
              <SettingsPanel settings={draft.settings} onChange={actions.setSettings} framesCount={stats.modes.frames} />

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
                    uploadsEnabled={configured}
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
                    {plural(stats.count, 'video')} · {draft.settings.duration}s · {draft.settings.resolution}
                  </strong>
                  <span className="muted">
                    {plural(stats.words, 'word')}
                    {saveFailed ? ' · draft too large to autosave' : ' · draft saved on this device'}
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
                <button type="button" className="button button-primary button-large" disabled={blocked} onClick={() => void generate()}>
                  {submitting ? <span className="spinner" /> : <Icon name="play" size={16} />}
                  {submitting ? 'Starting…' : stats.count === 1 ? 'Generate video' : `Generate ${formatNumber(stats.count)} videos`}
                </button>
              </footer>
            </>
          )}
        </section>

        <aside className="pane pane-jobs" aria-label="Generations">
          <JobsPanel jobs={jobs.jobs} loaded={jobs.loaded} error={jobs.error} now={now} actions={jobActions} />
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
      {confirmDialog}

      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`}>
            <Icon name={toast.tone === 'error' ? 'alert' : toast.tone === 'success' ? 'check' : 'sparkles'} size={16} />
            <span>{toast.message}</span>
            <button type="button" className="icon-button" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
