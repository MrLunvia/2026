/** Headers and footer shared by the pages. */
import { useState } from 'react';
import { api } from '../api.ts';
import { Link, navigate, useLocation } from '../router.tsx';
import { useSession } from '../session.tsx';
import { BuyCreditsDialog } from './BuyCredits.tsx';
import { Icon } from './Icon.tsx';

function Brand({ to }: { to: string }) {
  const { config } = useSession();
  return (
    <Link to={to} className="brand" aria-label={`${config?.appName ?? ''} home`}>
      <span className="brand-mark" aria-hidden="true">
        <Icon name="play" size={16} />
      </span>
      <span className="brand-name">{config?.appName}</span>
    </Link>
  );
}

/** Header for logged-in pages: navigation, balance (click to buy credit) and log out. */
export function SiteHeader({ running = 0 }: { running?: number }) {
  const { user, setUser, money } = useSession();
  const { path } = useLocation();
  const [buying, setBuying] = useState(false);
  if (!user) return null;
  const tab = (to: string, label: string, icon: Parameters<typeof Icon>[0]['name']) => (
    <Link to={to} className={path === to ? 'topnav-link is-active' : 'topnav-link'} aria-current={path === to ? 'page' : undefined}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
    </Link>
  );
  const logout = async () => {
    await api.logout().catch(() => undefined);
    setUser(null);
    navigate('/');
  };
  return (
    <header className="topbar">
      <Brand to="/app" />
      <nav className="topnav" aria-label="Main">
        {tab('/app', 'Studio', 'sparkles')}
        {tab('/account', 'Account', 'user')}
        {user.isAdmin && tab('/admin', 'Admin', 'shield')}
      </nav>
      <div className="topbar-status">
        {running > 0 && (
          <span className="pill pill-progress">
            <span className="pulse" aria-hidden="true" />
            {running} running
          </span>
        )}
        <button type="button" className="balance" onClick={() => setBuying(true)} title="Buy credit">
          <Icon name="wallet" size={16} />
          <span>{money(user.balanceCents)}</span>
          <span className="balance-add" aria-hidden="true">
            <Icon name="plus" size={12} />
            <span className="label-long">Top up</span>
          </span>
          <span className="sr-only">Buy credit</span>
        </button>
        <span className="avatar" title={user.email} aria-hidden="true">
          {(user.name || user.email).trim().charAt(0).toUpperCase()}
        </span>
        <button type="button" className="icon-button" onClick={() => void logout()} title="Log out" aria-label="Log out">
          <Icon name="logout" />
        </button>
      </div>
      <BuyCreditsDialog open={buying} onClose={() => setBuying(false)} />
    </header>
  );
}

/** Header for the landing, auth and legal pages. */
export function PublicHeader() {
  const { user } = useSession();
  return (
    <header className="topbar topbar-public">
      <Brand to="/" />
      <nav className="topnav topnav-public" aria-label="Main">
        <Link to="/#models" className="topnav-link">
          Models
        </Link>
        <Link to="/#features" className="topnav-link">
          Features
        </Link>
        <Link to="/#pricing" className="topnav-link">
          Pricing
        </Link>
        <Link to="/#faq" className="topnav-link">
          FAQ
        </Link>
      </nav>
      <div className="topbar-status">
        {user ? (
          <Link to="/app" className="button button-primary button-small">
            Open studio
          </Link>
        ) : (
          <>
            <Link to="/login" className="button button-ghost button-small">
              Log in
            </Link>
            <Link to="/signup" className="button button-primary button-small">
              <span className="label-long">Start creating</span>
              <span className="label-short">Sign up</span>
            </Link>
          </>
        )}
      </div>
    </header>
  );
}

export function SiteFooter() {
  const { config } = useSession();
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span>
          © {new Date().getFullYear()} {config?.appName}
        </span>
        <nav aria-label="Legal">
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/refunds">Refunds</Link>
          <Link to="/contact">Contact</Link>
        </nav>
      </div>
    </footer>
  );
}
