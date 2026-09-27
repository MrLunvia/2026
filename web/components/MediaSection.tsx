import { useState, type DragEvent } from 'react';
import { LIMITS, type MediaMode } from '../../shared/options.ts';
import type { ComposerActions, DraftImage, DraftPrompt, ImageSlot } from '../composer.ts';
import { Icon, type IconName } from './Icon.tsx';

const MODES: { id: MediaMode; label: string; icon: IconName }[] = [
  { id: 'text', label: 'Text only', icon: 'text' },
  { id: 'frames', label: 'Start / end frame', icon: 'frames' },
  { id: 'references', label: 'Reference images', icon: 'layers' },
];

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((file) => file.type.startsWith('image/'));
}

function Thumb({ image, label, onRemove, large = false }: { image: DraftImage; label?: string; onRemove: () => void; large?: boolean }) {
  return (
    <figure className={`thumb is-${image.status}${large ? ' thumb-large' : ''}`}>
      <img src={image.previewUrl} alt={label ?? image.name} loading="lazy" />
      {image.status === 'uploading' && (
        <span className="thumb-overlay" aria-label="Uploading">
          <span className="spinner" />
        </span>
      )}
      {image.status === 'error' && (
        <span className="thumb-overlay thumb-error" title={image.error}>
          <Icon name="alert" />
          <span>Upload failed</span>
        </span>
      )}
      <button type="button" className="thumb-remove" onClick={onRemove} aria-label={`Remove ${label ?? image.name}`}>
        <Icon name="x" size={14} />
      </button>
      {label && <figcaption>{label}</figcaption>}
    </figure>
  );
}

function DropTile({
  label,
  hint,
  multiple,
  disabled,
  onFiles,
  large = false,
}: {
  label: string;
  hint?: string;
  multiple: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => void;
  large?: boolean;
}) {
  const [over, setOver] = useState(false);
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (!disabled) onFiles(imageFiles(event.dataTransfer.files));
  };
  return (
    <label
      className={`drop-tile${over ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}${large ? ' drop-tile-large' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input
        type="file"
        accept={ACCEPT}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          onFiles(imageFiles(event.target.files));
          event.target.value = '';
        }}
      />
      <Icon name="upload" size={20} />
      <span className="drop-label">{label}</span>
      {hint && <span className="drop-hint">{hint}</span>}
    </label>
  );
}

function UrlAdder({ onAdd, disabled }: { onAdd: (url: string) => void; disabled: boolean }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const submit = () => {
    const url = value.trim();
    if (!/^https:\/\/\S+$/i.test(url)) {
      setError('Use a public https:// image URL');
      return;
    }
    onAdd(url);
    setValue('');
    setError(undefined);
  };
  return (
    <div className="url-adder">
      <Icon name="link" size={16} />
      <input
        type="url"
        inputMode="url"
        placeholder="…or paste a public image URL"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          setError(undefined);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        aria-invalid={error ? true : undefined}
        aria-label="Image URL"
      />
      <button type="button" className="button button-small button-ghost" onClick={submit} disabled={disabled || !value.trim()}>
        Add
      </button>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export function MediaSection({
  prompt,
  actions,
  uploadsEnabled,
}: {
  prompt: DraftPrompt;
  actions: ComposerActions;
  uploadsEnabled: boolean;
}) {
  const add = (slot: ImageSlot) => (files: File[]) => files.length > 0 && actions.addFiles(prompt.id, slot, files);
  const remove = (image: DraftImage) => () => actions.removeImage(prompt.id, image.id);
  const uploadHint = uploadsEnabled ? undefined : 'Uploads need HF_CREDENTIALS on the server';
  const framesFull = !!prompt.startImage && !!prompt.endImage;
  const referencesFull = prompt.references.length >= LIMITS.referenceImages;

  return (
    <div className="media">
      <div className="media-modes" role="radiogroup" aria-label="Images for this prompt">
        {MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={prompt.mode === mode.id}
            className={prompt.mode === mode.id ? 'media-mode is-active' : 'media-mode'}
            onClick={() => actions.changePrompt(prompt.id, { mode: mode.id })}
          >
            <Icon name={mode.icon} size={16} />
            {mode.label}
          </button>
        ))}
      </div>

      {prompt.mode === 'text' && (
        <p className="hint">
          Animate a still with a start frame, or add reference images to keep characters, products and style consistent. You can also paste an image.
        </p>
      )}

      {prompt.mode === 'frames' && (
        <>
          <div className="frames">
            {prompt.startImage ? (
              <Thumb image={prompt.startImage} label="Start frame" onRemove={remove(prompt.startImage)} large />
            ) : (
              <DropTile label="Start frame" hint={uploadHint ?? 'Required · drop 2 images for start + end'} multiple disabled={!uploadsEnabled} onFiles={add('start')} large />
            )}
            <Icon name="chevron" className="frames-arrow" />
            {prompt.endImage ? (
              <Thumb image={prompt.endImage} label="End frame" onRemove={remove(prompt.endImage)} large />
            ) : (
              <DropTile label="End frame" hint={uploadHint ?? 'Optional'} multiple={false} disabled={!uploadsEnabled} onFiles={add('end')} large />
            )}
          </div>
          <p className="hint">The video starts on the first image (and ends on the second, if set). Framing follows the start image.</p>
          <UrlAdder disabled={framesFull} onAdd={(url) => actions.addImageUrl(prompt.id, prompt.startImage ? 'end' : 'start', url)} />
        </>
      )}

      {prompt.mode === 'references' && (
        <>
          <div className="references">
            {prompt.references.map((image, i) => (
              <Thumb key={image.id} image={image} label={`Image ${i + 1}`} onRemove={remove(image)} />
            ))}
            {!referencesFull && (
              <DropTile label="Add images" hint={uploadHint ?? `${prompt.references.length}/${LIMITS.referenceImages}`} multiple disabled={!uploadsEnabled} onFiles={add('references')} />
            )}
          </div>
          <p className="hint">
            Up to {LIMITS.referenceImages} images of characters, products, places or style. Say how to use them in the prompt, e.g. “the woman in image 1 walks into the café from image 2”.
          </p>
          <UrlAdder disabled={referencesFull} onAdd={(url) => actions.addImageUrl(prompt.id, 'references', url)} />
        </>
      )}
    </div>
  );
}
