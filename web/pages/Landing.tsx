/** Public home page: a prompt box that leads into the studio, the models, what it can do, prices and answers. */
import { useEffect, useRef, useState } from 'react';
import { MODELS, modelById, qualityOf } from '../../shared/models.ts';
import { LIMITS } from '../../shared/options.ts';
import { fromPerSecondCents, headlinePriceCents } from '../../shared/pricing.ts';
import type { ShowcaseItem } from '../../shared/types.ts';
import { api } from '../api.ts';
import { savePendingPrompt } from '../composer.ts';
import { PublicHeader, SiteFooter } from '../components/Chrome.tsx';
import { Icon, type IconName } from '../components/Icon.tsx';
import { EXAMPLES, exampleText } from '../components/Inspiration.tsx';
import { ModelCardBody, ModelMark } from '../components/ModelPicker.tsx';
import { Scene } from '../components/Scene.tsx';
import { formatNumber } from '../format.ts';
import { offeredModels } from '../modelInfo.ts';
import { Link, navigate } from '../router.tsx';
import { useSession } from '../session.tsx';

const FEATURES: { icon: IconName; title: string; body: string; span?: 2 | 3 }[] = [
  {
    icon: 'sparkles',
    title: `${MODELS.length} leading video models`,
    body: 'Seedance, Kling, Wan, MiniMax, LTX, PixVerse, Grok Imagine, Happy Horse, Cinema Studio and Genjutsu, side by side in one studio. Switch any time; the price updates as you go.',
    span: 2,
  },
  {
    icon: 'camera',
    title: 'Camera moves and looks',
    body: 'Dolly, orbit, crash zoom, FPV drone, film noir, anime, product ad… pick a preset and it is written into your prompt.',
  },
  {
    icon: 'text',
    title: `Prompts up to ${formatNumber(LIMITS.promptWords)} words`,
    body: 'Paste a whole script. The scene splitter turns long stories into one video per scene, in order.',
  },
  {
    icon: 'image',
    title: 'Your images and videos',
    body: 'Animate a start frame, keep characters consistent with references, or edit, extend and transfer motion from your own clips.',
  },
  {
    icon: 'layers',
    title: 'Whole batches at once',
    body: 'Queue many prompts in one go and download each video as it finishes. Close the tab; it keeps going.',
  },
  {
    icon: 'shield',
    title: 'Pay per video, refunds automatic',
    body: 'No subscription. The exact price shows before you generate, and failed or blocked videos are refunded straight away.',
    span: 3,
  },
];

const STEPS: { title: string; body: string }[] = [
  { title: 'Describe it', body: 'Write a prompt, paste a script, or start from your own images and videos.' },
  { title: 'Pick a model and look', body: `Choose one of ${MODELS.length} models, then length, quality, ratio, camera move and style. The price updates as you go.` },
  { title: 'Generate and download', body: 'Watch progress live, then play, download or share each finished video.' },
];

/** A featured video that plays only while it is on screen. */
function ShowcaseVideo({ item }: { item: ShowcaseItem }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) void video.play().catch(() => undefined);
      else video.pause();
    });
    observer.observe(video);
    return () => observer.disconnect();
  }, []);
  const model = modelById(item.model);
  const quality = model ? qualityOf(model, item.quality) : undefined;
  return (
    <figure className="reel-item">
      <video ref={ref} src={item.videoUrl} muted loop playsInline preload="metadata" />
      <figcaption>
        <span className="reel-model">
          {model?.name ?? item.model}
          {quality ? ` · ${quality.label}` : ''}
        </span>
        <span className="reel-prompt">{item.title ?? item.promptPreview}</span>
      </figcaption>
    </figure>
  );
}

const SAMPLE_REEL = [
  { model: 'seedance-2.5', camera: 'dolly-in', look: 'golden-hour', caption: 'Harbor at golden hour' },
  { model: 'kling-3.0', camera: 'tracking', look: 'cyberpunk', caption: 'Neon rain' },
  { model: 'wan-3.0', camera: 'aerial', look: 'cinematic', caption: 'Mars walk' },
  { model: 'hailuo-2.3', camera: 'orbit', look: 'fantasy', caption: 'Enchanted valley' },
  { model: 'kling-o3', camera: 'crash-zoom', look: 'noir', caption: 'The detective' },
  { model: 'pixverse-6', camera: 'static', look: 'clay', caption: 'Clay fox' },
];

export function Landing() {
  const { config, user, money } = useSession();
  const [idea, setIdea] = useState('');
  const [chosen, setChosen] = useState('seedance-2.5');
  const [showcase, setShowcase] = useState<ShowcaseItem[]>([]);

  // Open /#pricing etc. at the right place on first load.
  useEffect(() => {
    const id = location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, []);

  useEffect(() => {
    api.showcase().then(setShowcase, () => undefined);
  }, []);

  if (!config) return null;
  const { pricing, payments } = config;
  const hero = headlinePriceCents(pricing);
  const start = user ? '/app' : '/signup';
  const offered = offeredModels(pricing.disabledModels);
  const model = offered.find((m) => m.id === chosen) ?? offered[0];
  const studioFor = (id: string) => (user ? `/app?model=${id}` : `/signup?next=${encodeURIComponent(`/app?model=${id}`)}`);
  const rate = (modelId: string, quality: string) => pricing.perSecond[modelId]?.[quality] ?? 0;
  const examples: { model: string; label: string; cents: number }[] = [
    { model: 'seedance-2.5', label: 'Seedance 2.5 · 30 s · 720p', cents: hero },
    { model: 'seedance-2.5', label: 'Seedance 2.5 · 30 s · 480p', cents: 30 * rate('seedance-2.5', '480p') },
    { model: 'kling-3.0', label: 'Kling 3.0 · 10 s · Standard', cents: 10 * rate('kling-3.0', 'std') },
    { model: 'wan-3.0', label: 'Wan 3.0 · 10 s · 1080p', cents: 10 * rate('wan-3.0', '1080p') },
  ].filter((example) => example.cents > 0 && !pricing.disabledModels.includes(example.model));
  const payWith =
    payments.provider === 'stripe'
      ? 'By card, through Stripe’s secure checkout.'
      : payments.provider === 'razorpay'
        ? 'By UPI, card, net banking or wallet, through Razorpay’s secure checkout.'
        : (payments.manualNote ?? `Contact ${config.supportEmail ?? 'support'} and we’ll add credit to your account.`);
  const faqs: { q: string; a: string }[] = [
    {
      q: 'How much does a video cost?',
      a: `Each model has a price per second of video, and the studio shows the exact total before anything is charged. A 30-second 720p Seedance 2.5 video is ${money(hero)}. When you upload a video to edit, extend or copy motion from, its length counts toward the seconds too.`,
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
      q: 'Can I use my own images and videos?',
      a: 'Yes, depending on the model: animate a start (and end) frame, add reference images, videos or audio to keep a character, product or style consistent, edit or extend a video, transfer its motion to a new character, or swap objects in it.',
    },
    {
      q: 'What do the camera and style presets do?',
      a: 'They add one plain sentence to your prompt, such as “Camera: slow, smooth dolly-in toward the subject.” You can see and edit it; the models follow written directions like these.',
    },
    {
      q: 'What isn’t allowed?',
      a: 'Sexual content, anything that puts minors at risk, real people without their consent, hateful or violent content, and anything illegal. Every request passes an automatic content filter; blocked requests are refunded.',
    },
    { q: 'Does credit expire?', a: 'No. Credit stays in your account until you use it.' },
    { q: 'How do I pay?', a: payWith },
  ];

  const submit = (event: { preventDefault(): void }) => {
    event.preventDefault();
    if (idea.trim()) savePendingPrompt(idea.trim());
    navigate(studioFor(model?.id ?? 'seedance-2.5'));
  };

  return (
    <div className="site site-landing">
      <PublicHeader />
      <main>
        <section className="hero">
          <div className="hero-glow" aria-hidden="true" />
          <span className="eyebrow">
            <Icon name="sparkles" size={14} />
            {MODELS.length} video models · up to 30 seconds · up to 4K
          </span>
          <h1>
            Turn any idea into a <span className="gradient-text">cinematic video</span>
          </h1>
          <p className="lead">
            Seedance, Kling, Wan and more in one studio. Write up to {formatNumber(LIMITS.promptWords)} words or start from your own images and
            videos. Pay per video, no subscription: a 30-second 720p Seedance 2.5 video is {money(hero)}.
          </p>

          <form className="hero-prompt" onSubmit={submit}>
            <label className="sr-only" htmlFor="hero-idea">
              Describe your video
            </label>
            <textarea
              id="hero-idea"
              rows={3}
              maxLength={5000}
              value={idea}
              placeholder="Describe the video you imagine… e.g. a lone astronaut crosses red dunes on Mars at sunset"
              onChange={(e) => setIdea(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit(e);
              }}
            />
            <div className="hero-prompt-bar">
              <label className="hero-model">
                {model && <ModelMark model={model} size={22} />}
                <span className="sr-only">Model</span>
                <select value={model?.id} onChange={(e) => setChosen(e.target.value)}>
                  {offered.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <Icon name="chevron" size={14} />
              </label>
              <button type="submit" className="button button-primary">
                <Icon name="sparkles" size={16} />
                {user ? 'Create in the studio' : 'Start creating'}
              </button>
            </div>
          </form>
          <div className="hero-examples" aria-label="Example prompts">
            {EXAMPLES.slice(0, 4).map((example) => (
              <button key={example.title} type="button" className="chip" onClick={() => setIdea(exampleText(example))}>
                {example.title}
              </button>
            ))}
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
        </section>

        <section className="reel" aria-label={showcase.length > 0 ? 'Videos made here' : 'What you can make'}>
          {showcase.length > 0
            ? showcase.slice(0, 8).map((item) => <ShowcaseVideo key={item.id} item={item} />)
            : SAMPLE_REEL.filter((item) => !pricing.disabledModels.includes(item.model)).map((item) => (
                <figure key={item.caption} className="reel-item">
                  <Scene camera={item.camera} look={item.look} playing />
                  <figcaption>
                    <span className="reel-model">{modelById(item.model)?.name}</span>
                    <span className="reel-prompt">{item.caption}</span>
                  </figcaption>
                </figure>
              ))}
        </section>

        <div className="marquee" aria-hidden="true">
          <div className="marquee-track">
            {[...offered, ...offered].map((m, i) => (
              <span key={`${m.id}-${i}`} className="marquee-item">
                <ModelMark model={m} size={22} />
                {m.name}
              </span>
            ))}
          </div>
        </div>

        <section id="models" className="section">
          <header className="section-head">
            <h2>Every top video model, one studio</h2>
            <p>Pick the right model for each shot. Prices are per second of video and shown before you generate.</p>
          </header>
          <div className="model-grid model-grid-landing">
            {offered.map((m) => (
              <Link key={m.id} to={studioFor(m.id)} className="model-card">
                <ModelCardBody model={m} fromCents={fromPerSecondCents(pricing, m.id)} money={money} />
                <span className="model-try">
                  Try {m.name}
                  <Icon name="arrow" size={14} />
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section id="features" className="section">
          <header className="section-head">
            <h2>Everything you need to go from words to video</h2>
            <p>Built for long scripts, big batches and consistent characters.</p>
          </header>
          <div className="bento">
            {FEATURES.map((feature) => (
              <article key={feature.title} className={feature.span ? `feature span-${feature.span}` : 'feature'}>
                <span className="feature-icon">
                  <Icon name={feature.icon} size={20} />
                </span>
                <h3>{feature.title}</h3>
                <p>{feature.body}</p>
                {feature.icon === 'camera' && (
                  <div className="feature-scenes" aria-hidden="true">
                    <Scene camera="orbit" playing />
                    <Scene camera="crash-zoom" look="noir" playing />
                    <Scene camera="fpv" look="anime" playing />
                  </div>
                )}
                {feature.icon === 'sparkles' && (
                  <div className="feature-models" aria-hidden="true">
                    {offered.slice(0, 12).map((m) => (
                      <ModelMark key={m.id} model={m} size={30} />
                    ))}
                  </div>
                )}
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
            <p>Buy credit once, spend it on any model. You always see the price before you generate.</p>
          </header>
          <div className="pricing">
            <div className="price-card price-card-main">
              <span className="eyebrow">Most popular</span>
              <div className="price">
                <strong>{money(hero)}</strong>
                <span>per video</span>
              </div>
              <p className="muted">Seedance 2.5 · 30 seconds · 720p · sound included</p>
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
              <p className="muted">Credit never expires and works with every model.</p>
              <ul className="price-list">
                {pricing.packsCents.map((pack) => {
                  const videos = hero > 0 ? Math.floor(pack / hero) : 0;
                  return (
                    <li key={pack}>
                      <span>{money(pack)}</span>
                      <strong>{videos > 0 ? `${videos} × 30s Seedance 720p` : 'Credit'}</strong>
                    </li>
                  );
                })}
              </ul>
              <p className="hint">
                <Icon name="lock" size={14} /> {payWith}
              </p>
            </div>
          </div>
          <div className="model-prices">
            <h3>Every model</h3>
            <ul>
              {offered.map((m) => {
                const from = fromPerSecondCents(pricing, m.id);
                return (
                  <li key={m.id}>
                    <span>
                      <strong>{m.name}</strong>
                      <small className="muted">{m.maker}</small>
                    </span>
                    <span>{from !== undefined ? `from ${money(from)}/s` : '—'}</span>
                  </li>
                );
              })}
            </ul>
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
          <div className="cta-scenes" aria-hidden="true">
            <Scene camera="dolly-in" look="golden-hour" playing />
            <Scene camera="pan-left" look="cyberpunk" playing />
            <Scene camera="crane-up" look="fantasy" playing />
          </div>
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
