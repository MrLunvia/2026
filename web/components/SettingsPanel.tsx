import { ASPECT_RATIOS, DURATION, RESOLUTIONS, type AspectRatio } from '../../shared/options.ts';
import type { GenerationSettings } from '../../shared/types.ts';
import { Icon } from './Icon.tsx';

const QUICK_DURATIONS = [5, 10, 15, 30];

function ratioShape(ratio: AspectRatio) {
  const [w, h] = ratio.split(':').map(Number) as [number, number];
  const scale = 22 / Math.max(w, h);
  return { width: `${Math.round(w * scale)}px`, height: `${Math.round(h * scale)}px` };
}

export function SettingsPanel({
  settings,
  onChange,
  framesCount,
}: {
  settings: GenerationSettings;
  onChange: (patch: Partial<GenerationSettings>) => void;
  framesCount: number;
}) {
  return (
    <section className="card settings" aria-labelledby="settings-title">
      <div className="card-heading">
        <h2 id="settings-title">Output</h2>
        <p className="hint">Applies to every prompt in this batch</p>
      </div>

      <div className="settings-grid">
        <div className="field">
          <label className="field-label" htmlFor="duration">
            Duration
          </label>
          <div className="duration-row">
            <input
              id="duration"
              type="range"
              min={DURATION.min}
              max={DURATION.max}
              step={1}
              value={settings.duration}
              onChange={(e) => onChange({ duration: Number(e.target.value) })}
            />
            <output htmlFor="duration" className="duration-value">
              {settings.duration}s
            </output>
          </div>
          <div className="chips" aria-label="Quick durations">
            {QUICK_DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                className={settings.duration === d ? 'chip is-active' : 'chip'}
                onClick={() => onChange({ duration: d })}
              >
                {d}s
              </button>
            ))}
          </div>
        </div>

        <fieldset className="field">
          <legend className="field-label">Resolution</legend>
          <div className="segmented">
            {RESOLUTIONS.map((r) => (
              <label key={r} className={settings.resolution === r ? 'segment is-active' : 'segment'}>
                <input
                  type="radio"
                  name="resolution"
                  value={r}
                  checked={settings.resolution === r}
                  onChange={() => onChange({ resolution: r })}
                />
                {r}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="field field-wide">
          <legend className="field-label">Aspect ratio</legend>
          <div className="ratios">
            {ASPECT_RATIOS.map((r) => (
              <label key={r} className={settings.aspectRatio === r ? 'ratio is-active' : 'ratio'}>
                <input
                  type="radio"
                  name="aspect-ratio"
                  value={r}
                  checked={settings.aspectRatio === r}
                  onChange={() => onChange({ aspectRatio: r })}
                />
                <span className="ratio-box">
                  <span className="ratio-shape" style={ratioShape(r)} />
                </span>
                <span>{r}</span>
              </label>
            ))}
          </div>
          {framesCount > 0 && <p className="hint">Prompts with a start frame keep that image's framing instead.</p>}
        </fieldset>

        <div className="field">
          <span className="field-label">Sound</span>
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={settings.generateAudio}
              onChange={(e) => onChange({ generateAudio: e.target.checked })}
            />
            <span className="switch-track" aria-hidden="true" />
            <Icon name="volume" size={16} />
            <span>Generate audio</span>
          </label>
        </div>
      </div>
    </section>
  );
}
