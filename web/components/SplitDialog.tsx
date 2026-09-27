import { useDeferredValue, useMemo, useState } from 'react';
import { LIMITS } from '../../shared/options.ts';
import { countWords, splitIntoScenes, type Scene } from '../../shared/text.ts';
import type { DraftPrompt } from '../composer.ts';
import { formatElapsed, formatNumber, plural } from '../format.ts';
import { Dialog } from './Dialog.tsx';

const PREVIEW_LIMIT = 150;

export function SplitDialog({
  prompt,
  duration,
  otherPrompts,
  onClose,
  onApply,
}: {
  prompt: DraftPrompt | undefined;
  duration: number;
  /** Prompts in the composer besides this one (for the batch limit). */
  otherPrompts: number;
  onClose: () => void;
  onApply: (scenes: Scene[], options: { prefix: string; copyReferences: boolean }) => void;
}) {
  const [maxWords, setMaxWords] = useState(150);
  const [prefix, setPrefix] = useState('');
  const [copyReferences, setCopyReferences] = useState(true);
  const deferredMax = useDeferredValue(maxWords);
  const text = prompt?.text ?? '';
  const scenes = useMemo(() => (text ? splitIntoScenes(text, deferredMax) : []), [text, deferredMax]);
  const prefixWords = countWords(prefix);
  const overBatch = otherPrompts + scenes.length > LIMITS.promptsPerBatch;

  return (
    <Dialog
      open={prompt !== undefined}
      wide
      title="Split into scenes"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={scenes.length < 1 || overBatch}
            onClick={() => onApply(scenes, { prefix, copyReferences })}
          >
            Replace with {plural(scenes.length, 'prompt')}
          </button>
        </>
      }
    >
      <p className="dialog-lead">
        Each scene becomes its own prompt and its own {duration}s video. Scene headings (“Scene 3”, “INT. KITCHEN – NIGHT”, “# Title”)
        and <code>---</code> lines start new scenes; otherwise paragraphs are grouped up to the word limit.
      </p>

      <div className="split-controls">
        <label className="field">
          <span className="field-label">
            Max words per scene <output>{maxWords}</output>
          </span>
          <input type="range" min={30} max={1000} step={10} value={maxWords} onChange={(e) => setMaxWords(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="field-label">Style prefix for every scene (optional)</span>
          <textarea
            rows={2}
            value={prefix}
            placeholder="e.g. Cinematic, 35mm film look, warm golden-hour grade, same two lead characters throughout."
            onChange={(e) => setPrefix(e.target.value)}
          />
        </label>
        {prompt?.mode === 'references' && (
          <label className="checkbox">
            <input type="checkbox" checked={copyReferences} onChange={(e) => setCopyReferences(e.target.checked)} />
            Use this prompt's reference images in every scene
          </label>
        )}
        {prompt?.mode === 'frames' && <p className="hint">The start/end frames stay with the first scene; the others become text prompts.</p>}
      </div>

      <div className={scenes.length > 50 || overBatch ? 'split-summary is-warning' : 'split-summary'}>
        <strong>{plural(scenes.length, 'scene')}</strong>
        <span>≈ {formatElapsed(scenes.length * duration * 1000)} of video in total</span>
        {prefixWords > 0 && <span>+{plural(prefixWords, 'word')} of prefix each</span>}
        {overBatch ? (
          <span>That's over the {formatNumber(LIMITS.promptsPerBatch)}-prompt batch limit; raise the words per scene.</span>
        ) : (
          scenes.length > 50 && <span>Each scene is a separate paid generation.</span>
        )}
      </div>

      <ol className="scene-list">
        {scenes.slice(0, PREVIEW_LIMIT).map((scene, i) => {
          // The heading stays in the prompt text (it carries the setting); don't show it twice here.
          const heading = scene.title?.replace(/ \(part \d+\)$/, '');
          const body = heading && scene.text.startsWith(heading) ? scene.text.slice(heading.length).trim() : scene.text;
          return (
            <li key={i}>
              <div className="scene-head">
                <strong>{scene.title ?? `Scene ${i + 1}`}</strong>
                <span className="muted">{plural(countWords(scene.text), 'word')}</span>
              </div>
              <p>{body.length > 240 ? `${body.slice(0, 240)}…` : body}</p>
            </li>
          );
        })}
      </ol>
      {scenes.length > PREVIEW_LIMIT && <p className="hint">…and {formatNumber(scenes.length - PREVIEW_LIMIT)} more.</p>}
    </Dialog>
  );
}
