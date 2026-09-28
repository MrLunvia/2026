import { useState } from 'react';
import { MODELS, modelById, modelControls, qualityOf, type VideoModel } from '../../shared/models.ts';
import { fromPerSecondCents, perSecondCents } from '../../shared/pricing.ts';
import type { GenerationSettings, Pricing } from '../../shared/types.ts';
import { Dialog } from './Dialog.tsx';
import { Icon } from './Icon.tsx';

const QUICK_DURATIONS = [5, 10, 15, 30];

function ratioShape(ratio: string) {
  if (ratio === 'auto') return { width: '18px', height: '18px', borderStyle: 'dashed' };
  const [w, h] = ratio.split(':').map(Number) as [number, number];
  const scale = 22 / Math.max(w, h);
  return { width: `${Math.round(w * scale)}px`, height: `${Math.round(h * scale)}px` };
}

/** Short capability chips for a model card. */
function capabilities(model: VideoModel): string[] {
  const specs = model.qualities.flatMap((q) => Object.values(q.inputs));
  const maxSeconds = Math.max(0, ...specs.map((s) => (s.duration ? ('options' in s.duration ? Math.max(...s.duration.options) : s.duration.max) : 0)));
  const top = ['4K', '2K', '1080p', '768p', '720p', '540p', '480p', '360p'].find((r) =>
    model.qualities.some((q) => q.label.toUpperCase().includes(r.toUpperCase()) || q.resolution?.toUpperCase() === r.toUpperCase()),
  );
  const chips = [maxSeconds > 0 ? `Up to ${maxSeconds}s` : 'Video to video', ...(top ? [`Up to ${top}`] : [])];
  if (specs.some((s) => s.audio === 'generate_audio' || s.audio === 'sound')) chips.push('Sound');
  if (specs.some((s) => s.start)) chips.push('Image to video');
  if (specs.some((s) => s.source || s.videos)) chips.push('Video input');
  return chips;
}

function ModelPicker({
  open,
  current,
  pricing,
  money,
  onClose,
  onPick,
}: {
  open: boolean;
  current: string;
  pricing: Pricing;
  money: (cents: number) => string;
  onClose: () => void;
  onPick: (model: string) => void;
}) {
  const offered = MODELS.filter((model) => !pricing.disabledModels.includes(model.id));
  return (
    <Dialog open={open} wide title="Choose a video model" onClose={onClose}>
      <div className="model-grid">
        {offered.map((model) => {
          const from = fromPerSecondCents(pricing, model.id);
          return (
            <button
              key={model.id}
              type="button"
              className={model.id === current ? 'model-card is-active' : 'model-card'}
              aria-pressed={model.id === current}
              onClick={() => onPick(model.id)}
            >
              <span className="model-card-head">
                <strong>{model.name}</strong>
                <span className="muted">{model.maker}</span>
              </span>
              <span className="model-card-text">{model.description}</span>
              <span className="model-chips">
                {capabilities(model).map((chip) => (
                  <span key={chip} className="model-chip">
                    {chip}
                  </span>
                ))}
              </span>
              {from !== undefined && <span className="model-price">from {money(from)} / second</span>}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  pricing,
  money,
  hint,
}: {
  settings: GenerationSettings;
  onChange: (patch: Partial<GenerationSettings>) => void;
  pricing: Pricing;
  money: (cents: number) => string;
  hint?: string;
}) {
  const [picking, setPicking] = useState(false);
  const model = modelById(settings.model) ?? MODELS[0]!;
  const quality = qualityOf(model, settings.quality) ?? model.qualities[0]!;
  const controls = modelControls(model, quality.id);
  const duration = controls.duration;
  const discrete = duration && 'options' in duration ? duration.options : undefined;
  const range = duration && 'min' in duration ? duration : undefined;

  return (
    <section className="card settings" aria-labelledby="settings-title">
      <div className="card-heading">
        <h2 id="settings-title">Model & output</h2>
        {hint && <p className="hint">{hint}</p>}
      </div>

      <button type="button" className="model-button" onClick={() => setPicking(true)} aria-label={`Model: ${model.name}. Change model`}>
        <span className="model-mark" aria-hidden="true">
          <Icon name="film" size={18} />
        </span>
        <span className="model-button-text">
          <strong>{model.name}</strong>
          <span className="muted">
            {model.maker} · {model.description}
          </span>
        </span>
        <span className="model-change">
          Change
          <Icon name="chevron" size={14} />
        </span>
      </button>

      <div className="settings-grid">
        {model.qualities.length > 1 && (
          <fieldset className="field field-wide">
            <legend className="field-label">Quality</legend>
            <div className="segmented segmented-wrap">
              {model.qualities.map((q) => {
                const rate = perSecondCents(pricing, model.id, q.id);
                return (
                  <label key={q.id} className={q.id === quality.id ? 'segment is-active' : 'segment'}>
                    <input type="radio" name="quality" value={q.id} checked={q.id === quality.id} onChange={() => onChange({ quality: q.id })} />
                    <span>{q.label}</span>
                    {rate !== undefined && <small className="segment-price">{money(rate)}/s</small>}
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="field">
          <span className="field-label" id="duration-label">
            Duration
          </span>
          {!duration ? (
            <p className="hint">Each video is as long as the video you upload.</p>
          ) : discrete ? (
            <div className="chips" role="radiogroup" aria-labelledby="duration-label">
              {discrete.map((d) => (
                <button key={d} type="button" role="radio" aria-checked={settings.duration === d} className={settings.duration === d ? 'chip is-active' : 'chip'} onClick={() => onChange({ duration: d })}>
                  {d}s
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="duration-row">
                <input
                  id="duration"
                  type="range"
                  aria-labelledby="duration-label"
                  min={range!.min}
                  max={range!.max}
                  step={1}
                  value={settings.duration}
                  onChange={(e) => onChange({ duration: Number(e.target.value) })}
                />
                <output htmlFor="duration" className="duration-value">
                  {settings.duration}s
                </output>
              </div>
              <div className="chips" aria-label="Quick durations">
                {QUICK_DURATIONS.filter((d) => d >= range!.min && d <= range!.max).map((d) => (
                  <button key={d} type="button" className={settings.duration === d ? 'chip is-active' : 'chip'} onClick={() => onChange({ duration: d })}>
                    {d}s
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {controls.audio && (
          <div className="field">
            <span className="field-label">Sound</span>
            <label className="switch">
              <input type="checkbox" role="switch" checked={settings.generateAudio} onChange={(e) => onChange({ generateAudio: e.target.checked })} />
              <span className="switch-track" aria-hidden="true" />
              <Icon name="volume" size={16} />
              <span>{controls.inputs.includes('motion') && controls.inputs.length === 1 ? 'Keep the video’s sound' : 'Generate audio'}</span>
            </label>
          </div>
        )}

        {controls.aspectRatios.length > 0 && (
          <fieldset className="field field-wide">
            <legend className="field-label">Aspect ratio</legend>
            <div className="ratios">
              {controls.aspectRatios.map((r) => (
                <label key={r} className={settings.aspectRatio === r ? 'ratio is-active' : 'ratio'}>
                  <input type="radio" name="aspect-ratio" value={r} checked={settings.aspectRatio === r} onChange={() => onChange({ aspectRatio: r })} />
                  <span className="ratio-box">
                    <span className="ratio-shape" style={ratioShape(r)} />
                  </span>
                  <span>{r === 'auto' ? 'Auto' : r}</span>
                </label>
              ))}
            </div>
            <p className="hint">Prompts that start from an image or a video keep its framing where the model decides it.</p>
          </fieldset>
        )}
      </div>

      <ModelPicker
        open={picking}
        current={model.id}
        pricing={pricing}
        money={money}
        onClose={() => setPicking(false)}
        onPick={(id) => {
          onChange({ model: id });
          setPicking(false);
        }}
      />
    </section>
  );
}
