/** Public home page: what the product does, what it costs, answers, and a way in. */
import { useEffect } from 'react';
import { LIMITS, MODEL_LABEL } from '../../shared/options.ts';
import { videoPriceCents } from '../../shared/pricing.ts';
import { Icon, type IconName } from '../components/Icon.tsx';
import { PublicHeader, SiteFooter } from '../components/Chrome.tsx';
import { formatNumber } from '../format.ts';
import { Link } from '../router.tsx';
import { useSession } from '../session.tsx';

const FEATURES: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'text',
    title: `Prompts up to ${formatNumber(LIMITS.promptWords)} words`,
    body: 'Paste a whole script. The scene splitter turns long stories into one video per scene, in order.',
  },
  {
    icon: 'image',
    title: 'Your images, animated',
    body: `Bring a start frame (and an end frame), or up to ${LIMITS.referenceImages} reference images for characters, products and style.`,
  },
  {
    icon: 'film',
    title: '30-second 720p videos',
    body: 'Cinematic clips from 4 to 30 seconds, in six aspect ratios from 21:9 to 9:16, with generated sound.',
  },
  {
    icon: 'layers',
    title: 'Whole batches at once',
    body: 'Queue many prompts in one go and download each video as it finishes. Close the tab; it keeps going.',
  },
  {
    icon: 'wallet',
    title: 'Pay per video',
    body: 'No subscription. Buy credit when you need it; it never expires. The exact price shows before you generate.',
  },
  {
    icon: 'shield',
    title: 'Automatic refunds',
    body: "If a video fails or is blocked by the content filter, the full price goes straight back to your balance.",
  },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Write or paste', body: 'Describe the scene, paste a script, or import .txt files. Add images if you have them.' },
  { title: 'Pick the format', body: 'Choose length, resolution, aspect ratio and sound. The price updates as you go.' },
  { title: 'Generate and download', body: 'Watch progress live, then play, download or share each finished video.' },
];

export function Landing() {
  const { config, user, money } = useSession();

  // Open /#pricing etc. at the right place on first load.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, []);

  if (!config) return null;
  const { pricing, payments } = config;
  const hero = videoPriceCents({ duration: 30, resolution: '720p' }, pricing);
  const start = user ? '/app' : '/signup';
  const examples: { label: string; cents: number }[] = [
    { label: '30 seconds · 720p', cents: hero },
    { label: '15 seconds · 720p', cents: videoPriceCents({ duration: 15, resolution: '720p' }, pricing) },
    { label: '30 seconds · 480p', cents: videoPriceCents({ duration: 30, resolution: '480p' }, pricing) },
    { label: '5 seconds · 480p', cents: videoPriceCents({ duration: 5, resolution: '480p' }, pricing) },
  ];
  const payWith =
    payments.provider === 'stripe'
      ? 'By card, through Stripe’s secure checkout.'
      : payments.provider === 'razorpay'
        ? 'By UPI, card, net banking or wallet, through Razorpay’s secure checkout.'
        : (payments.manualNote ?? `Contact ${config.supportEmail ?? 'support'} and we’ll add credit to your account.`);
  const faqs: { q: string; a: string }[] = [
    {
      q: 'How much does a video cost?',
      a: `${money(hero)} for a 30-second 720p video. You pay per second of video: ${money(pricing.perSecondCents['720p'])} a second at 720p and ${money(pricing.perSecondCents['480p'])} at 480p. The exact total is shown before anything is charged.`,
    },
    {
      q: 'What if a video fails?',
      a: 'If a video fails, is blocked by the content filter, or can’t be started, its full price is returned to your balance automatically. Videos that haven’t started yet can be canceled for a full refund.',
    },
    {
      q: 'How long does it take?',
      a: 'Most videos are ready in a few minutes; long or busy batches take longer. You can close the page — your videos keep generating and wait for you under My videos.',
    },
    {
      q: 'Can I use my own images?',
      a: `Yes. Animate a start image (optionally toward an end image), or add up to ${LIMITS.referenceImages} reference images to keep a character, product or style consistent.`,
    },
    {
      q: 'What isn’t allowed?',
      a: 'Sexual content, anything that puts minors at risk, real people without their consent, hateful or violent content, and anything illegal. Every request passes an automatic content filter; blocked requests are refunded.',
    },
    { q: 'Does credit expire?', a: 'No. Credit stays in your account until you use it.' },
    { q: 'How do I pay?', a: payWith },
  ];

  return (
    <div className="site">
      <PublicHeader />
      <main>
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow">
              <Icon name="sparkles" size={14} />
              {MODEL_LABEL} · up to 30 seconds · 720p
            </span>
            <h1>
              Turn any script into a <span className="gradient-text">cinematic video</span>
            </h1>
            <p className="lead">
              Write up to {formatNumber(LIMITS.promptWords)} words or start from your own images. {config.appName} turns it into a
              30-second 720p video with sound — {money(hero)} per video, no subscription.
            </p>
            <div className="hero-actions">
              <Link to={start} className="button button-primary button-large">
                {user ? 'Open the studio' : 'Start creating'}
                <Icon name="arrow" size={16} />
              </Link>
              <Link to="/#pricing" className="button button-ghost button-large">
                See pricing
              </Link>
            </div>
            <ul className="hero-trust">
              <li>
                <Icon name="check" size={14} /> Pay only for what you make
              </li>
              <li>
                <Icon name="check" size={14} /> Failed videos refunded
              </li>
              <li>
                <Icon name="check" size={14} /> Credit never expires
              </li>
            </ul>
            {!user && pricing.signupBonusCents > 0 && (
              <p className="hero-bonus">
                <Icon name="zap" size={14} /> {money(pricing.signupBonusCents)} free credit when you sign up
              </p>
            )}
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="mock">
              <div className="mock-bar">
                <span />
                <span />
                <span />
              </div>
              <div className="mock-prompt">
                <span className="mock-label">Prompt 1</span>
                <p>
                  Golden hour over a quiet harbor. The camera glides low across the water toward a lone fishing boat as gulls wheel
                  overhead and the sun slips behind the hills…
                </p>
              </div>
              <div className="mock-video">
                <span className="mock-play">
                  <Icon name="play" size={22} />
                </span>
                <span className="mock-time">0:30</span>
              </div>
              <div className="mock-footer">
                <span>30s · 720p · 16:9</span>
                <strong>{money(hero)}</strong>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="section">
          <header className="section-head">
            <h2>Everything you need to go from words to video</h2>
            <p>Built for long scripts, big batches and consistent characters.</p>
          </header>
          <div className="feature-grid">
            {FEATURES.map((feature) => (
              <article key={feature.title} className="feature">
                <span className="feature-icon">
                  <Icon name={feature.icon} size={20} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section">
          <header className="section-head">
            <h2>How it works</h2>
          </header>
          <ol className="steps">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="step-number">{i + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id="pricing" className="section">
          <header className="section-head">
            <h2>Simple, per-video pricing</h2>
            <p>Buy credit once, spend it on any video. You always see the price before you generate.</p>
          </header>
          <div className="pricing">
            <div className="price-card price-card-main">
              <span className="eyebrow">Most popular</span>
              <div className="price">
                <strong>{money(hero)}</strong>
                <span>per video</span>
              </div>
              <p className="muted">30 seconds · 720p · sound included</p>
              <ul className="price-list">
                {examples.map((example) => (
                  <li key={example.label}>
                    <span>{example.label}</span>
                    <strong>{money(example.cents)}</strong>
                  </li>
                ))}
              </ul>
              <Link to={start} className="button button-primary button-large">
                {user ? 'Open the studio' : 'Create your account'}
              </Link>
            </div>
            <div className="price-card">
              <h3>Credit packs</h3>
              <p className="muted">Credit never expires and works for any length or resolution.</p>
              <ul className="price-list">
                {pricing.packsCents.map((pack) => {
                  const videos = hero > 0 ? Math.floor(pack / hero) : 0;
                  return (
                    <li key={pack}>
                      <span>{money(pack)}</span>
                      <strong>{videos > 0 ? `${videos} × 30s 720p video${videos === 1 ? '' : 's'}` : 'Credit'}</strong>
                    </li>
                  );
                })}
              </ul>
              <p className="hint">
                <Icon name="lock" size={14} /> {payWith}
              </p>
            </div>
          </div>
        </section>

        <section id="faq" className="section">
          <header className="section-head">
            <h2>Questions</h2>
          </header>
          <div className="faq">
            {faqs.map((faq) => (
              <details key={faq.q}>
                <summary>{faq.q}</summary>
                <p>{faq.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="section cta">
          <h2>Your first video is a prompt away</h2>
          <p>Sign up in seconds, add credit, and generate.</p>
          <Link to={start} className="button button-primary button-large">
            {user ? 'Open the studio' : 'Start creating'}
            <Icon name="arrow" size={16} />
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
