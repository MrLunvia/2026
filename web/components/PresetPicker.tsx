import { useEffect, useState } from 'react';
import { PRESETS, type Preset, type PresetFamily } from '../../shared/presets.ts';
import { Dialog } from './Dialog.tsx';
import { Icon } from './Icon.tsx';
import { Scene } from './Scene.tsx';

const TITLES: Record<PresetFamily, { title: string; lead: string }> = {
  camera: { title: 'Camera movement', lead: 'Pick how the camera moves. It adds one line to your prompt, which you can edit.' },
  style: { title: 'Visual style', lead: 'Pick a look. It adds one line to your prompt, which you can edit.' },
};

/** Camera-move or look presets as animated tiles; picking one writes its sentence into the prompt. */
export function PresetPicker({
  family,
  current,
  prompts,
  onClose,
  onPick,
}: {
  /** Open when set. */
  family?: PresetFamily;
  /** The prompt's current preset id, if any. */
  current?: string;
  /** How many prompts the batch has ("apply to all" appears when there are several). */
  prompts: number;
  onClose: () => void;
  onPick: (preset: Preset | undefined, everyPrompt: boolean) => void;
}) {
  const [everyPrompt, setEveryPrompt] = useState(false);
  useEffect(() => {
    if (family) setEveryPrompt(false);
  }, [family]);
  const text = TITLES[family ?? 'camera'];

  return (
    <Dialog
      open={family !== undefined}
      size="wide"
      className="preset-dialog"
      title={text.title}
      onClose={onClose}
      footer={
        prompts > 1 ? (
          <label className="checkbox">
            <input type="checkbox" checked={everyPrompt} onChange={(e) => setEveryPrompt(e.target.checked)} />
            Apply to all {prompts} prompts
          </label>
        ) : undefined
      }
    >
      <p className="dialog-lead">{text.lead}</p>
      <div className="preset-grid">
        <button type="button" className={current ? 'preset-tile' : 'preset-tile is-active'} aria-pressed={!current} onClick={() => onPick(undefined, everyPrompt)}>
          <span className="scene scene-none" aria-hidden="true">
            <Icon name="x" size={22} />
          </span>
          <span className="preset-name">None</span>
        </button>
        {family &&
          PRESETS[family].map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={current === preset.id ? 'preset-tile is-active' : 'preset-tile'}
              aria-pressed={current === preset.id}
              title={preset.phrase}
              onClick={() => onPick(preset, everyPrompt)}
            >
              <Scene camera={family === 'camera' ? preset.id : undefined} look={family === 'style' ? preset.id : undefined} playing={current === preset.id} />
              <span className="preset-name">{preset.name}</span>
            </button>
          ))}
      </div>
    </Dialog>
  );
}
