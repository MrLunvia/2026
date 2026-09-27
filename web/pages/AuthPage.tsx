/** Log in, sign up, forgot password and reset password. */
import { useState, type FormEvent } from 'react';
import { LIMITS } from '../../shared/options.ts';
import { videoPriceCents } from '../../shared/pricing.ts';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { PublicHeader, SiteFooter } from '../components/Chrome.tsx';
import { formatNumber } from '../format.ts';
import { Link, navigate, safeNext, useLocation } from '../router.tsx';
import { useSession } from '../session.tsx';
import { useUi } from '../ui.tsx';

export type AuthMode = 'login' | 'signup' | 'forgot' | 'reset';

const TITLES: Record<AuthMode, { title: string; lead: string; submit: string }> = {
  login: { title: 'Welcome back', lead: 'Log in to your studio.', submit: 'Log in' },
  signup: { title: 'Create your account', lead: 'Start turning prompts into videos.', submit: 'Create account' },
  forgot: { title: 'Reset your password', lead: "Enter your email and we'll send you a link to choose a new password.", submit: 'Send reset link' },
  reset: { title: 'Choose a new password', lead: 'Use at least 8 characters. You will be logged out on other devices.', submit: 'Save password' },
};

export function AuthPage({ mode }: { mode: AuthMode }) {
  const { config, setUser, money } = useSession();
  const { notify } = useUi();
  const { query } = useLocation();
  const next = safeNext(query.get('next'));
  const withNext = (path: string) => (next === '/app' ? path : `${path}?next=${encodeURIComponent(next)}`);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState(false);
  if (!config) return null;
  const text = TITLES[mode];
  const bonus = config.pricing.signupBonusCents;
  const token = query.get('token') ?? '';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(undefined);
    if ((mode === 'reset' || mode === 'signup') && password.length < 8) return setError('Use at least 8 characters for your password');
    if (mode === 'reset' && password !== repeat) return setError("The two passwords don't match");
    if (mode === 'signup' && !accepted) return setError('Please accept the Terms of Service and Privacy Policy');
    setBusy(true);
    try {
      if (mode === 'login') {
        setUser(await api.login(email, password));
        navigate(next, { replace: true });
      } else if (mode === 'signup') {
        setUser(await api.signup({ name, email, password, acceptTerms: accepted }));
        notify(bonus > 0 ? `Welcome! ${money(bonus)} of free credit is in your account.` : 'Welcome! Your account is ready.', 'success');
        navigate(next, { replace: true });
      } else if (mode === 'forgot') {
        await api.forgot(email);
        setSent(true);
      } else {
        setUser(await api.reset(token, password));
        notify('Password updated', 'success');
        navigate('/app', { replace: true });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const hero = videoPriceCents({ duration: 30, resolution: '720p' }, config.pricing);

  return (
    <div className="site">
      <PublicHeader />
      <main className="auth">
        <section className="auth-card card">
          <h1>{text.title}</h1>
          <p className="muted">{text.lead}</p>

          {mode === 'forgot' && !config.emailEnabled ? (
            <div className="banner banner-info">
              <Icon name="mail" size={16} />
              <div>
                <strong>Password reset by email isn't available yet.</strong>
                <p>{config.supportEmail ? `Email ${config.supportEmail} from your account's address and we'll help you get back in.` : 'Please contact support.'}</p>
              </div>
            </div>
          ) : mode === 'forgot' && sent ? (
            <div className="banner banner-success" role="status">
              <Icon name="mail" size={16} />
              <div>
                <strong>Check your inbox.</strong>
                <p>If an account exists for {email}, a reset link is on its way. It expires in 1 hour.</p>
              </div>
            </div>
          ) : mode === 'reset' && !token ? (
            <div className="banner banner-error" role="alert">
              <Icon name="alert" size={16} />
              <div>
                <strong>This reset link is incomplete.</strong>
                <p>Open the link from the email again, or request a new one.</p>
              </div>
            </div>
          ) : (
            <form className="form" onSubmit={(e) => void submit(e)} noValidate>
              {mode === 'signup' && (
                <label className="form-field">
                  <span>Name</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
                </label>
              )}
              {mode !== 'reset' && (
                <label className="form-field">
                  <span>Email</span>
                  <input
                    className="input"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    required
                    autoFocus
                  />
                </label>
              )}
              {mode !== 'forgot' && (
                <label className="form-field">
                  <span className="form-label-row">
                    {mode === 'reset' ? 'New password' : 'Password'}
                    {mode === 'login' && (
                      <Link to={withNext('/forgot')} className="form-aside">
                        Forgot password?
                      </Link>
                    )}
                  </span>
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    minLength={mode === 'login' ? undefined : 8}
                    required
                    autoFocus={mode === 'reset'}
                  />
                  {mode === 'signup' && <small className="hint">At least 8 characters</small>}
                </label>
              )}
              {mode === 'reset' && (
                <label className="form-field">
                  <span>Repeat new password</span>
                  <input className="input" type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required />
                </label>
              )}
              {mode === 'signup' && (
                <label className="checkbox">
                  <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
                  <span>
                    I agree to the <Link to="/terms">Terms of Service</Link>, <Link to="/privacy">Privacy Policy</Link> and{' '}
                    <Link to="/refunds">Refund Policy</Link>.
                  </span>
                </label>
              )}

              {error && (
                <p className="banner banner-error" role="alert">
                  <Icon name="alert" size={16} />
                  {error}
                </p>
              )}

              <button type="submit" className="button button-primary button-large" disabled={busy}>
                {busy && <span className="spinner" />}
                {text.submit}
              </button>
            </form>
          )}

          <p className="auth-switch">
            {mode === 'login' && (
              <>
                New here? <Link to={withNext('/signup')}>Create an account</Link>
              </>
            )}
            {mode === 'signup' && (
              <>
                Already have an account? <Link to={withNext('/login')}>Log in</Link>
              </>
            )}
            {(mode === 'forgot' || mode === 'reset') && (
              <>
                Remembered it? <Link to={withNext('/login')}>Back to log in</Link>
              </>
            )}
          </p>
        </section>

        <aside className="auth-aside">
          <h2>What you get</h2>
          <ul>
            <li>
              <Icon name="film" size={18} />
              <span>
                <strong>{money(hero)} per 30-second 720p video</strong> — pay per video, no subscription
              </span>
            </li>
            <li>
              <Icon name="text" size={18} />
              <span>
                <strong>Prompts up to {formatNumber(LIMITS.promptWords)} words</strong>, split into scenes automatically
              </span>
            </li>
            <li>
              <Icon name="image" size={18} />
              <span>
                <strong>Image references</strong> for start frames, characters and products
              </span>
            </li>
            <li>
              <Icon name="shield" size={18} />
              <span>
                <strong>Automatic refunds</strong> when a video fails or is blocked
              </span>
            </li>
            {bonus > 0 && (
              <li>
                <Icon name="zap" size={18} />
                <span>
                  <strong>{money(bonus)} free credit</strong> when you sign up
                </span>
              </li>
            )}
          </ul>
        </aside>
      </main>
      <SiteFooter />
    </div>
  );
}
