/** Page routing, with log-in and admin guards. */
import { useEffect } from 'react';
import { Icon } from './components/Icon.tsx';
import { Account } from './pages/Account.tsx';
import { Admin } from './pages/Admin.tsx';
import { AuthPage, type AuthMode } from './pages/AuthPage.tsx';
import { Landing } from './pages/Landing.tsx';
import { Legal, type LegalPage } from './pages/Legal.tsx';
import { Studio } from './pages/Studio.tsx';
import { Link, navigate, safeNext, useLocation } from './router.tsx';
import { SessionProvider, useSession } from './session.tsx';
import { UiProvider } from './ui.tsx';

const AUTH_PAGES: AuthMode[] = ['login', 'signup', 'forgot', 'reset'];
const LEGAL_PAGES: LegalPage[] = ['terms', 'privacy', 'refunds', 'contact'];

function Redirect({ to }: { to: string }) {
  useEffect(() => navigate(to, { replace: true }), [to]);
  return null;
}

function Splash({ error }: { error?: string }) {
  return (
    <div className="splash">
      {error ? (
        <div className="banner banner-error">
          <Icon name="alert" size={16} />
          <div>
            <strong>Can't reach the server.</strong>
            <p>{error}. Check your connection and reload the page.</p>
          </div>
        </div>
      ) : (
        <span className="spinner" aria-label="Loading" />
      )}
    </div>
  );
}

function NotFound() {
  return (
    <div className="splash">
      <div className="not-found">
        <h1>Page not found</h1>
        <p className="muted">The page you're looking for doesn't exist.</p>
        <Link to="/" className="button button-primary">
          Go home
        </Link>
      </div>
    </div>
  );
}

function Routes() {
  const { path, query } = useLocation();
  const { config, configError, user } = useSession();
  const page = path.replace(/\/+$/, '').slice(1);

  if (!config) return <Splash error={configError} />;
  if (page === '') return <Landing />;

  if ((LEGAL_PAGES as string[]).includes(page)) return <Legal page={page as LegalPage} />;

  if ((AUTH_PAGES as string[]).includes(page)) {
    if (user === undefined) return <Splash />;
    // Already logged in: skip the form (a reset link still works, e.g. from another account's email).
    if (user && page !== 'reset') return <Redirect to={safeNext(query.get('next'))} />;
    return <AuthPage key={page} mode={page as AuthMode} />;
  }

  if (page === 'app' || page === 'account' || page === 'admin') {
    if (user === undefined) return <Splash />;
    if (user === null) return <Redirect to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} />;
    if (page === 'app') return <Studio key={user.id} />;
    if (page === 'account') return <Account />;
    return user.isAdmin ? <Admin /> : <NotFound />;
  }

  return <NotFound />;
}

export function App() {
  return (
    <SessionProvider>
      <UiProvider>
        <Routes />
      </UiProvider>
    </SessionProvider>
  );
}
