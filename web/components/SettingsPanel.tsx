import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { MODELS, modelById, modelControls, qualityOf } from '../../shared/models.ts';
import { perSecondCents } from '../../shared/pricing.ts';
import type { GenerationSettings, Pricing } from '../../shared/types.ts';
import { MODEL_BADGES } from '../modelInfo.ts';
import { Icon, type IconName } from './Icon.tsx';
import { ModelMark, ModelPicker } from './ModelPicker.tsx';

const QUICK_DURATIONS = [5, 10, 15, 30];

function ratioShape(ratio: string) {
  if (ratio === 'auto') return { width: '14px', height: '14px', borderStyle: 'dashed' };
  const [w, h] = ratio.split(':').map(Number) as [number, number];
  const scale = 18 / Math.max(w, h);
  return { width: `${Math.round(w * scale)}px`, height: `${Math.round(h * scale)}px` };
}

type Settings = {
  settings: GenerationSettings;
  onChange: (patch: Partial<GenerationSettings>) => void;
  pricing: Pricing;
  money: (cents: number) => string;
};

/** The chosen model, with a button that opens the model picker. */
export function ModelSection({ settings, onChange, pricing, money, hint }: Settings & { hint?: string }) {
  const [picking, setPicking] = useState(false);
  const model = modelById(settings.model) ?? MODELS[0]!;
  const badge = MODEL_BADGES[model.id];
  return (
    <section className="panel-block model-section" aria-labelledby="model-title">
      <div className="block-head">
        <h2 id="model-title">Model</h2>
        {hint && <p className="hint">{hint}</p>}
      </div>
      <button type="button" className="model-button" onClick={() => setPicking(true)} aria-label={`Model: ${model.name}. Change model`}>
        <ModelMark model={model} size={42} />
        <span className="model-button-text">
          <strong>
            {model.name}
            {badge && <span className={`model-badge is-${badge.toLowerCase()}`}>{badge}</span>}
          </strong>
          <span className="muted">
            {model.maker} · {model.description}
          </span>
        </span>
        <span className="model-change">
          Change
          <Icon name="chevron" size={14} />
        </span>
      </button>
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

type Panel = 'quality' | 'duration' | 'ratio';

function SettingChip({
  id,
  icon,
  label,
  value,
  open,
  disabled,
  onToggle,
}: {
  id: Panel;
  icon: IconName;
  label: string;
  value: string;
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={open ? 'setting-chip is-open' : 'setting-chip'}
      aria-expanded={disabled ? undefined : open}
      aria-controls={disabled ? undefined : `setting-${id}`}
      aria-label={`${label}: ${value}`}
      title={label}
      disabled={disabled}
      onClick={onToggle}
    >
      <Icon name={icon} size={15} />
      <strong>{value}</strong>
      {!disabled && <Icon name="chevron" size={13} />}
    </button>
  );
}

/** Quality, duration, aspect ratio and sound as compact buttons above Generate; each opens its options. */
export function OutputSettings({ settings, onChange, pricing, money }: Settings) {
  const [open, setOpen] = useState<Panel>();
  const dock = useRef<HTMLDivElement>(null);
  const model = modelById(settings.model) ?? MODELS[0]!;
  const quality = qualityOf(model, settings.quality) ?? model.qualities[0]!;
  const controls = modelControls(model, quality.id);
  const duration = controls.duration;
  const discrete = duration && 'options' in duration ? duration.options : undefined;
  const range = duration && 'min' in duration ? duration : undefined;
  const ratio = settings.aspectRatio === 'auto' ? 'Auto' : settings.aspectRatio;

  // Close on a click elsewhere or Esc (focus goes back to the button that opened it).
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!dock.current?.contains(event.target as Node)) setOpen(undefined);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(undefined);
      dock.current?.querySelector<HTMLButtonElement>(`[aria-controls="setting-${open}"]`)?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (panel: Panel) => () => setOpen((current) => (current === panel ? undefined : panel));
  const pick = (patch: Partial<GenerationSettings>) => {
    onChange(patch);
    setOpen(undefined);
  };

  return (
    <div className="settings-dock" ref={dock}>
      {open === 'quality' && (
        <div id="setting-quality" className="setting-panel" role="group" aria-label="Quality">
          <p className="setting-title">Quality</p>
          <div className="quality-options" role="radiogroup" aria-label="Quality">
            {model.qualities.map((q) => {
              const rate = perSecondCents(pricing, model.id, q.id);
              return (
                <button
                  key={q.id}
                  type="button"
                  role="radio"
                  aria-checked={q.id === quality.id}
                  className={q.id === quality.id ? 'quality-option is-active' : 'quality-option'}
                  onClick={() => pick({ quality: q.id })}
                >
                  <span>{q.label}</span>
                  {rate !== undefined && <small>{money(rate)}/s</small>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {open === 'duration' && duration && (
        <div id="setting-duration" className="setting-panel" role="group" aria-label="Duration">
          <p className="setting-title">
            Duration
            <output htmlFor="duration" className="duration-value">
              {settings.duration}s
            </output>
          </p>
          {discrete ? (
            <div className="chips" role="radiogroup" aria-label="Duration">
              {discrete.map((d) => (
                <button key={d} type="button" role="radio" aria-checked={settings.duration === d} className={settings.duration === d ? 'chip is-active' : 'chip'} onClick={() => pick({ duration: d })}>
                  {d}s
                </button>
              ))}
            </div>
          ) : (
            <div className="duration-row">
              <input
                id="duration"
                type="range"
                aria-label="Duration in seconds"
                min={range!.min}
                max={range!.max}
                step={1}
                value={settings.duration}
                style={{ '--fill': `${((settings.duration - range!.min) / Math.max(1, range!.max - range!.min)) * 100}%` } as CSSProperties}
                onChange={(e) => onChange({ duration: Number(e.target.value) })}
              />
              <div className="chips" aria-label="Quick durations">
                {QUICK_DURATIONS.filter((d) => d >= range!.min && d <= range!.max).map((d) => (
                  <button key={d} type="button" className={settings.duration === d ? 'chip is-active' : 'chip'} onClick={() => onChange({ duration: d })}>
                    {d}s
                  </button>
                ))}
                <span className="hint">
                  {range!.min}–{range!.max} s
                </span>
              </div>
            </div>
          )}
        </div>
      )}
      {open === 'ratio' && controls.aspectRatios.length > 0 && (
        <div id="setting-ratio" className="setting-panel" role="group" aria-label="Aspect ratio">
          <p className="setting-title">Aspect ratio</p>
          <div className="ratios" role="radiogroup" aria-label="Aspect ratio">
            {controls.aspectRatios.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={settings.aspectRatio === r}
                className={settings.aspectRatio === r ? 'ratio is-active' : 'ratio'}
                title={r === 'auto' ? 'Auto: follows your image or video' : r}
                onClick={() => pick({ aspectRatio: r })}
              >
                <span className="ratio-box">
                  <span className="ratio-shape" style={ratioShape(r)} />
                </span>
                <span>{r === 'auto' ? 'Auto' : r}</span>
              </button>
            ))}
          </div>
          <p className="hint">Prompts that start from an image or a video keep its framing where the model decides it.</p>
        </div>
      )}

      <div className="setting-chips">
        <SettingChip id="quality" icon="hd" label="Quality" value={quality.label} open={open === 'quality'} disabled={model.qualities.length < 2} onToggle={toggle('quality')} />
        <SettingChip id="duration" icon="clock" label="Duration" value={duration ? `${settings.duration}s` : 'From video'} open={open === 'duration'} disabled={!duration} onToggle={toggle('duration')} />
        {controls.aspectRatios.length > 0 && <SettingChip id="ratio" icon="ratio" label="Aspect ratio" value={ratio} open={open === 'ratio'} onToggle={toggle('ratio')} />}
        {controls.audio && (
          <button
            type="button"
            className={settings.generateAudio ? 'setting-chip is-on' : 'setting-chip'}
            aria-pressed={settings.generateAudio}
            title={controls.inputs.includes('motion') && controls.inputs.length === 1 ? 'Keep the video’s sound' : 'Generate audio'}
            onClick={() => onChange({ generateAudio: !settings.generateAudio })}
          >
            <Icon name="volume" size={15} />
            <strong>{settings.generateAudio ? 'Sound' : 'No sound'}</strong>
          </button>
        )}
      </div>
    </div>
  );
}
