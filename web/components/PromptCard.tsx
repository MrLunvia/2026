import { memo, useMemo, useRef, type ClipboardEvent } from 'react';
import { LIMITS } from '../../shared/options.ts';
import { countWords } from '../../shared/text.ts';
import { activeImages, promptProblems, type ComposerActions, type DraftPrompt } from '../composer.ts';
import { formatNumber } from '../format.ts';
import { Icon } from './Icon.tsx';
import { MediaSection } from './MediaSection.tsx';

// Video models follow focused prompts best; past this, suggest splitting.
const LONG_PROMPT_WORDS = 800;
const TEXT_ACCEPT = '.txt,.md,.markdown,.fountain,text/plain,text/markdown';

export const PromptCard = memo(function PromptCard({
  prompt,
  index,
  showProblems,
  uploadsEnabled,
  actions,
  onSplit,
  onGenerate,
}: {
  prompt: DraftPrompt;
  index: number;
  showProblems: boolean;
  uploadsEnabled: boolean;
  actions: ComposerActions;
  onSplit: (id: string) => void;
  onGenerate: () => void;
}) {
  const words = useMemo(() => countWords(prompt.text), [prompt.text]);
  const problems = useMemo(() => promptProblems(prompt, words), [prompt, words]);
  const fileInput = useRef<HTMLInputElement>(null);
  const over = words > LIMITS.promptWords;
  const uploading = activeImages(prompt).some((image) => image.status === 'uploading');
  const label = `Prompt ${index + 1}`;

  const onPaste = (event: ClipboardEvent) => {
    const files = [...event.clipboardData.files].filter((file) => file.type.startsWith('image/'));
    if (files.length === 0 || !uploadsEnabled) return;
    event.preventDefault();
    if (prompt.mode === 'frames') {
      actions.addFiles(prompt.id, prompt.startImage ? 'end' : 'start', files);
    } else {
      if (prompt.mode === 'text') actions.changePrompt(prompt.id, { mode: 'references' });
      actions.addFiles(prompt.id, 'references', files);
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
    <article id={`prompt-${prompt.id}`} className={`card prompt-card${over ? ' is-over' : ''}`} onPaste={onPaste} aria-label={label}>
      <header className="prompt-header">
        <span className="prompt-index" aria-hidden="true">
          {index + 1}
        </span>
        <input
          className="prompt-title"
          value={prompt.title}
          maxLength={200}
          placeholder={`${label} · add a title (optional)`}
          aria-label={`${label} title`}
          onChange={(e) => actions.changePrompt(prompt.id, { title: e.target.value })}
        />
        <div className="prompt-tools">
          <button type="button" className="icon-button" title="Import a text file" aria-label="Import a text file" onClick={() => fileInput.current?.click()}>
            <Icon name="file" />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Split into scenes"
            aria-label="Split into scenes"
            disabled={words < 2 || uploading}
            onClick={() => onSplit(prompt.id)}
          >
            <Icon name="scissors" />
          </button>
          <button type="button" className="icon-button" title="Duplicate" aria-label="Duplicate prompt" onClick={() => actions.duplicatePrompt(prompt.id)}>
            <Icon name="copy" />
          </button>
          <button type="button" className="icon-button is-danger" title="Remove" aria-label="Remove prompt" onClick={() => actions.removePrompt(prompt.id)}>
            <Icon name="trash" />
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

      <textarea
        className="prompt-text"
        value={prompt.text}
        spellCheck
        aria-label={label}
        aria-invalid={over || undefined}
        placeholder={
          'Describe the shot: subject, action, setting, camera movement, lighting, mood.\n' +
          'Long script? Paste it here (up to 50,000 words) or import a .txt file, then split it into scenes.'
        }
        onChange={(e) => actions.changePrompt(prompt.id, { text: e.target.value })}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault();
            onGenerate();
          }
        }}
      />

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

      <MediaSection prompt={prompt} actions={actions} uploadsEnabled={uploadsEnabled} />

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
