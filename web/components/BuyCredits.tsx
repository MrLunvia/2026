import { useState } from 'react';
import { headlinePriceCents } from '../../shared/pricing.ts';
import type { CheckoutStart, PublicUser } from '../../shared/types.ts';
import { api } from '../api.ts';
import { useSession } from '../session.tsx';
import { useUi } from '../ui.tsx';
import { Dialog } from './Dialog.tsx';
import { Icon } from './Icon.tsx';

type RazorpayStart = Extract<CheckoutStart, { kind: 'razorpay' }>;

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load the payment window. Check your connection and try again.'));
    document.head.append(script);
  });
}

/** Opens Razorpay's checkout popup; resolves with the confirmed result, or undefined if the customer closes it. */
async function payWithRazorpay(start: RazorpayStart): Promise<{ status: string; user: PublicUser } | undefined> {
  await loadScript('https://checkout.razorpay.com/v1/checkout.js');
  const Razorpay = (window as unknown as { Razorpay: new (options: object) => { open(): void; on(event: string, cb: (r: { error?: { description?: string } }) => void): void } }).Razorpay;
  return new Promise((resolve, reject) => {
    const popup = new Razorpay({
      key: start.keyId,
      amount: start.amount,
      currency: start.currency,
      name: start.name,
      description: start.description,
      order_id: start.orderId,
      prefill: { email: start.email },
      theme: { color: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#8b5cf6' },
      handler: (response: RazorpayResponse) => {
        api
          .confirmRazorpay({ orderId: response.razorpay_order_id, paymentId: response.razorpay_payment_id, signature: response.razorpay_signature })
          .then(resolve, reject);
      },
      modal: { ondismiss: () => resolve(undefined) },
    });
    popup.on('payment.failed', (r) => reject(new Error(r.error?.description ?? 'The payment failed')));
    popup.open();
  });
}

export function BuyCreditsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { config, user, setUser, money, refreshUser } = useSession();
  const { notify } = useUi();
  const [busy, setBusy] = useState<number>();
  if (!config || !user) return null;
  const perVideo = headlinePriceCents(config.pricing);
  const provider = config.payments.provider;

  const buy = async (packCents: number) => {
    setBusy(packCents);
    try {
      const start = await api.checkout(packCents);
      if (start.kind === 'redirect') {
        window.location.href = start.url; // Stripe's secure checkout page; it sends the customer back here.
        return;
      }
      const result = await payWithRazorpay(start);
      if (!result) return;
      if (result.status === 'paid') {
        setUser(result.user);
        notify(`Payment received: ${money(packCents)} added to your balance`, 'success');
        onClose();
      } else {
        notify('Payment received. It will appear in your balance in a moment.', 'info');
        setTimeout(() => void refreshUser(), 5_000);
        onClose();
      }
    } catch (error) {
      notify((error as Error).message, 'error');
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Dialog open={open} wide title="Buy credit" onClose={onClose}>
      <p className="dialog-lead">
        Pay once, use any time: credit never expires and works with every model. A 30-second 720p Seedance 2.5 video costs {money(perVideo)}; the studio shows each price before you generate. Videos that fail or are blocked
        are refunded to your balance automatically.
      </p>
      {provider === 'manual' ? (
        <div className="banner banner-info">
          <Icon name="wallet" size={16} />
          <div>
            <strong>How to buy credit</strong>
            <p>{config.payments.manualNote ?? `Contact ${config.supportEmail ?? 'support'} to buy credit; it is added to your account by hand.`}</p>
          </div>
        </div>
      ) : (
        <div className="packs">
          {config.pricing.packsCents.map((pack) => {
            const videos = perVideo > 0 ? Math.floor(pack / perVideo) : 0;
            return (
              <button key={pack} type="button" className="pack" disabled={busy !== undefined} onClick={() => void buy(pack)}>
                <span className="pack-amount">{money(pack)}</span>
                <span className="pack-videos">{videos > 0 ? `${videos} × 30s Seedance 720p` : 'Credit'}</span>
                <span className="button button-primary button-small">{busy === pack ? <span className="spinner" /> : 'Buy'}</span>
              </button>
            );
          })}
        </div>
      )}
      <p className="hint pay-note">
        <Icon name="lock" size={14} />
        {provider === 'stripe' && 'Card payments are handled securely by Stripe. '}
        {provider === 'razorpay' && 'Payments are handled securely by Razorpay (cards, UPI, net banking). '}
        Your balance: {money(user.balanceCents)}.
      </p>
    </Dialog>
  );
}
