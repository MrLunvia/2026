/** App-wide toasts and confirmation dialogs. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { Dialog } from './components/Dialog.tsx';
import { Icon } from './components/Icon.tsx';
import { uid } from './format.ts';

export type Notify = (message: string, tone?: 'info' | 'success' | 'error') => void;

export interface ConfirmRequest {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  /** When set, a checkbox with this text must be ticked first (large paid batches). */
  acknowledge?: string;
  danger?: boolean;
}

interface Ui {
  notify: Notify;
  confirm(request: ConfirmRequest): Promise<boolean>;
}

const UiContext = createContext<Ui | undefined>(undefined);

interface Toast {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'error';
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
          <button
            type="button"
            className={request.danger ? 'button button-danger' : 'button button-primary'}
            disabled={!acknowledged}
            onClick={() => onDone(true)}
          >
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

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<ConfirmRequest & { resolve: (ok: boolean) => void }>();

  const dismiss = useCallback((id: string) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const notify: Notify = useCallback(
    (message, tone = 'info') => {
      const id = uid();
      setToasts((all) => [...all.slice(-3), { id, message, tone }]);
      setTimeout(() => dismiss(id), tone === 'error' ? 8_000 : 4_500);
    },
    [dismiss],
  );
  const confirm = useCallback((request: ConfirmRequest) => new Promise<boolean>((resolve) => setPending({ ...request, resolve })), []);
  const value = useMemo(() => ({ notify, confirm }), [notify, confirm]);

  return (
    <UiContext.Provider value={value}>
      {children}
      {pending && (
        <ConfirmDialog
          request={pending}
          onDone={(ok) => {
            pending.resolve(ok);
            setPending(undefined);
          }}
        />
      )}
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
    </UiContext.Provider>
  );
}

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error('useUi outside UiProvider');
  return ui;
}
