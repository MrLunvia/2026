import { memo, useMemo, useRef, type ClipboardEvent } from 'react';
import { endpointFor } from '../../shared/models.ts';
import { LIMITS } from '../../shared/options.ts';
import { presetIn, type PresetFamily } from '../../shared/presets.ts';
import { countWords } from '../../shared/text.ts';
import type { GenerationSettings } from '../../shared/types.ts';
import { activeMedia, promptProblems, type ComposerActions, type DraftPrompt } from '../composer.ts';
import { formatNumber } from '../format.ts';
import { Icon } from './Icon.tsx';
import { MediaSection } from './MediaSection.tsx';

// Video models follow focused prompts best; past this, suggest splitting.
const LONG_PROMPT_WORDS = 800;
const TEXT_ACCEPT = '.txt,.md,.markdown,.fountain,text/plain,text/markdown';

export const PromptCard = memo(function PromptCard({
  prompt,
  index,
  total,
  settings,
  price,
  showProblems,
  uploadsEnabled,
  actions,
  onSplit,
  onPreset,
  onGenerate,
}: {
  prompt: DraftPrompt;
  index: number;
  /** How many prompts the batch has. */
  total: number;
  settings: GenerationSettings;
  /** This prompt's price, formatted, when it can be made. */
  price?: string;
  showProblems: boolean;
  uploadsEnabled: boolean;
  actions: ComposerActions;
  onSplit: (id: string) => void;
  onPreset: (id: string, family: PresetFamily) => void;
  onGenerate: () => void;
}) {
  const words = useMemo(() => countWords(prompt.text), [prompt.text]);
  const problems = useMemo(() => promptProblems(prompt, settings, words), [prompt, settings, words]);
  const camera = useMemo(() => presetIn(prompt.text, 'camera'), [prompt.text]);
  const style = useMemo(() => presetIn(prompt.text, 'style'), [prompt.text]);
  const fileInput = useRef<HTMLInputElement>(null);
  const over = words > LIMITS.promptWords;
  const spec = endpointFor(settings, prompt.mode);
  const uploading = activeMedia(prompt, spec).some((m) => m.status === 'uploading');
  const label = `Prompt ${index + 1}`;

  // Pasted images go where this prompt takes images; a text prompt switches to references if it can.
  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
    if (files.length === 0 || !uploadsEnabled) return;
    if (spec?.start && (!prompt.start || (spec.end && !prompt.end))) {
      event.preventDefault();
      actions.addFiles(prompt.id, prompt.start ? 'end' : 'start', files);
    } else if (spec?.images) {
      event.preventDefault();
      actions.addFiles(prompt.id, 'references', files);
    } else if (prompt.mode === 'text' && endpointFor(settings, 'references')?.images) {
      event.preventDefault();
      actions.changePrompt(prompt.id, { mode: 'references' });
      actions.addFiles(prompt.id, 'references', files, 'references');
    }
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    actions.changePrompt(prompt.id, {
      text: prompt.text.trim() ? `${prompt.text}\n\n${text}` : text,
      title: prompt.title || file.name.replace(/\.[^.]+$/, ''),
    });
  };

  return (
    <article id={`prompt-${prompt.id}`} className={`prompt-card${over ? ' is-over' : ''}${showProblems && problems.length > 0 ? ' has-problems' : ''}`} onPaste={onPaste} aria-label={label}>
      <header className="prompt-header">
        {total > 1 && (
          <span className="prompt-index" aria-hidden="true">
            {index + 1}
          </span>
        )}
        <input
          className="prompt-title"
          value={prompt.title}
          maxLength={200}
          placeholder={total > 1 ? `${label} · add a title (optional)` : 'Add a title (optional)'}
          aria-label={`${label} title`}
          onChange={(e) => actions.changePrompt(prompt.id, { title: e.target.value })}
        />
        <div className="prompt-tools">
          <button type="button" className="icon-button" title="Import a text file" aria-label="Import a text file" onClick={() => fileInput.current?.click()}>
            <Icon name="file" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Split into scenes"
            aria-label="Split into scenes"
            disabled={words < 2 || uploading}
            onClick={() => onSplit(prompt.id)}
          >
            <Icon name="scissors" size={16} />
          </button>
          <button type="button" className="icon-button" title="Duplicate" aria-label="Duplicate prompt" onClick={() => actions.duplicatePrompt(prompt.id)}>
            <Icon name="copy" size={16} />
          </button>
          <button type="button" className="icon-button is-danger" title="Remove" aria-label="Remove prompt" onClick={() => actions.removePrompt(prompt.id)}>
            <Icon name="trash" size={16} />
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          hidden
          accept={TEXT_ACCEPT}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void importFile(file);
          }}
        />
      </header>

      <MediaSection prompt={prompt} settings={settings} actions={actions} uploadsEnabled={uploadsEnabled} />

      <div className="prompt-box">
        <textarea
          className="prompt-text"
          value={prompt.text}
          spellCheck
          aria-label={label}
          aria-invalid={over || undefined}
          placeholder={
            'Describe the scene you imagine: subject, action, setting, camera, lighting, mood.\n' +
            'Long script? Paste it (up to 50,000 words) or import a .txt file, then split it into scenes.'
          }
          onChange={(e) => actions.changePrompt(prompt.id, { text: e.target.value })}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              onGenerate();
            }
          }}
        />
        <div className="prompt-presets">
          <button type="button" className={camera ? 'preset-chip is-set' : 'preset-chip'} onClick={() => onPreset(prompt.id, 'camera')} aria-label={`Camera movement: ${camera?.name ?? 'none'}`}>
            <Icon name="camera" size={15} />
            <span>{camera?.name ?? 'Camera'}</span>
          </button>
          <button type="button" className={style ? 'preset-chip is-set' : 'preset-chip'} onClick={() => onPreset(prompt.id, 'style')} aria-label={`Visual style: ${style?.name ?? 'none'}`}>
            <Icon name="palette" size={15} />
            <span>{style?.name ?? 'Style'}</span>
          </button>
          {price && <span className="prompt-price">{price}</span>}
        </div>
      </div>

      <div className="counter">
        <div className="meter" aria-hidden="true">
          <span style={{ width: `${Math.min(100, (words / LIMITS.promptWords) * 100)}%` }} />
        </div>
        <span className={over ? 'counter-words is-over' : 'counter-words'}>
          {formatNumber(words)} / {formatNumber(LIMITS.promptWords)} words
        </span>
        <span className="muted">{formatNumber(prompt.text.length)} characters</span>
        {words > LONG_PROMPT_WORDS && (
          <button type="button" className="link-button" onClick={() => onSplit(prompt.id)} disabled={uploading}>
            <Icon name="scissors" size={14} />
            Split into scenes
          </button>
        )}
      </div>

      {(showProblems || over) && problems.length > 0 && (
        <ul className="problems">
          {problems.map((problem) => (
            <li key={problem}>
              <Icon name="alert" size={14} />
              {problem}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
});
