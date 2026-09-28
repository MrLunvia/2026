import { useState, type DragEvent } from 'react';
import { INPUT_TYPES, endpointFor, inputLabel, modelById, qualityOf, type EndpointSpec, type InputType, type MediaKind } from '../../shared/models.ts';
import { UPLOAD_ACCEPT } from '../../shared/options.ts';
import type { GenerationSettings } from '../../shared/types.ts';
import { referenceLimits, type ComposerActions, type DraftMedia, type DraftPrompt, type Slot } from '../composer.ts';
import { Icon, type IconName } from './Icon.tsx';

const MODE_ICON: Record<InputType, IconName> = {
  text: 'text',
  frames: 'frames',
  references: 'layers',
  edit: 'scissors',
  extend: 'arrow',
  motion: 'user',
  swap: 'refresh',
  'video-reference': 'film',
};

const KIND_LABEL: Record<MediaKind, string> = { image: 'Image', video: 'Video', audio: 'Audio' };

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

function Thumb({ media, label, onRemove, large = false }: { media: DraftMedia; label?: string; onRemove: () => void; large?: boolean }) {
  const name = label ?? media.name;
  return (
    <figure className={`thumb is-${media.status} kind-${media.kind}${large ? ' thumb-large' : ''}`}>
      {media.kind === 'image' && <img src={media.previewUrl} alt={name} loading="lazy" />}
      {media.kind === 'video' && <video src={media.previewUrl} muted playsInline preload="metadata" aria-label={name} />}
      {media.kind === 'audio' && (
        <span className="thumb-audio">
          <Icon name="volume" size={22} />
          <span>{media.name}</span>
        </span>
      )}
      {media.seconds !== undefined && <span className="thumb-length">{clock(media.seconds)}</span>}
      {media.status === 'uploading' && (
        <span className="thumb-overlay" aria-label="Uploading">
          <span className="spinner" />
          {media.progress !== undefined && media.progress > 0 && <span className="thumb-progress">{Math.round(media.progress * 100)}%</span>}
        </span>
      )}
      {media.status === 'error' && (
        <span className="thumb-overlay thumb-error" title={media.error}>
          <Icon name="alert" />
          <span>Upload failed</span>
        </span>
      )}
      <button type="button" className="thumb-remove" onClick={onRemove} aria-label={`Remove ${name}`}>
        <Icon name="x" size={14} />
      </button>
      {label && <figcaption>{label}</figcaption>}
    </figure>
  );
}

function DropTile({
  label,
  hint,
  kinds,
  multiple,
  disabled,
  onFiles,
  large = false,
}: {
  label: string;
  hint?: string;
  kinds: MediaKind[];
  multiple: boolean;
  disabled: boolean;
  onFiles: (files: File[]) => void;
  large?: boolean;
}) {
  const [over, setOver] = useState(false);
  const accept = kinds.map((kind) => UPLOAD_ACCEPT[kind]).join(',');
  // Every file goes through; the composer explains what doesn't fit.
  const pick = (list: FileList | null | undefined) => [...(list ?? [])];
  return (
    <label
      className={`drop-tile${over ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}${large ? ' drop-tile-large' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event: DragEvent) => {
        event.preventDefault();
        setOver(false);
        if (!disabled) onFiles(pick(event.dataTransfer.files));
      }}
    >
      <input
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          onFiles(pick(event.target.files));
          event.target.value = '';
        }}
      />
      <Icon name={kinds.length === 1 && kinds[0] === 'video' ? 'film' : kinds.length === 1 && kinds[0] === 'audio' ? 'volume' : 'upload'} size={20} />
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

function hintFor(mode: InputType, spec: EndpointSpec, genjutsu: boolean): string {
  switch (mode) {
    case 'text':
      return 'Describe the shot. Switch to another tab to start from an image, references or a video.';
    case 'frames':
      return `The video starts on this image${spec.end ? ' (and ends on the second, if you add one)' : ''}.`;
    case 'references':
      return 'Say how to use them in the prompt, e.g. “the woman in image 1 walks into the café from image 2”. Reference videos add their length to the billed seconds.';
    case 'edit':
      return 'Describe the change to make. Priced by your video’s length.';
    case 'extend':
      return 'Continues your video by the chosen duration. Priced by your video’s length plus the new seconds.';
    case 'motion':
      return genjutsu
        ? 'The characters in your images take over the motion of the video. Priced by the video’s length.'
        : 'The character in the image copies the motion in the video. Priced by the video’s length.';
    case 'swap':
      return 'Objects from your images replace ones in the video. Priced by the video’s length.';
    case 'video-reference':
      return 'Makes a new video guided by yours, plus optional images. Priced by your video’s length plus the new seconds.';
  }
}

export function MediaSection({
  prompt,
  settings,
  actions,
  uploadsEnabled,
}: {
  prompt: DraftPrompt;
  settings: GenerationSettings;
  actions: ComposerActions;
  uploadsEnabled: boolean;
}) {
  const model = modelById(settings.model);
  const quality = model ? qualityOf(model, settings.quality) : undefined;
  if (!model || !quality) return null;
  const offered = INPUT_TYPES.filter((input) => model.qualities.some((q) => q.inputs[input]));
  const spec = endpointFor(settings, prompt.mode);
  const add = (slot: Slot) => (files: File[]) => files.length > 0 && actions.addFiles(prompt.id, slot, files);
  const remove = (media: DraftMedia) => () => actions.removeMedia(prompt.id, media.id);
  const uploadHint = uploadsEnabled ? undefined : 'Uploads are unavailable right now';
  const genjutsu = model.id === 'genjutsu';
  const limits = referenceLimits(spec);
  const refKinds = Object.keys(limits) as MediaKind[];
  const counters = refKinds.map((kind) => `${KIND_LABEL[kind]}s ${prompt.references.filter((r) => r.kind === kind).length}/${limits[kind]!.max}`).join(' · ');
  const refsFull = refKinds.every((kind) => prompt.references.filter((r) => r.kind === kind).length >= limits[kind]!.max);
  const refTitle = prompt.mode === 'motion' ? 'Character images' : prompt.mode === 'swap' ? 'Object images' : prompt.mode === 'references' ? '' : 'Extra references (optional)';

  return (
    <div className="media">
      <div className="media-modes" role="radiogroup" aria-label="What this prompt starts from">
        {offered.map((mode) => {
          const available = !!quality.inputs[mode];
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={prompt.mode === mode}
              disabled={!available && prompt.mode !== mode}
              title={available ? undefined : `Not available with ${model.name} ${quality.label}`}
              className={prompt.mode === mode ? 'media-mode is-active' : 'media-mode'}
              onClick={() => actions.changePrompt(prompt.id, { mode })}
            >
              <Icon name={MODE_ICON[mode]} size={16} />
              {inputLabel(model, mode)}
            </button>
          );
        })}
      </div>

      {spec && <p className="hint">{hintFor(prompt.mode, spec, genjutsu)}</p>}

      {spec && (spec.start || spec.source) && (
        <div className="frames">
          {spec.start &&
            (prompt.start ? (
              <Thumb media={prompt.start} label={prompt.mode === 'motion' ? 'Character' : 'Start frame'} onRemove={remove(prompt.start)} large />
            ) : (
              <DropTile
                label={prompt.mode === 'motion' ? 'Character image' : 'Start frame'}
                hint={uploadHint ?? (spec.end ? 'Required · drop 2 images for start + end' : 'Required')}
                kinds={['image']}
                multiple={!!spec.end}
                disabled={!uploadsEnabled}
                onFiles={add('start')}
                large
              />
            ))}
          {spec.start && spec.end && <Icon name="chevron" className="frames-arrow" />}
          {spec.end &&
            (prompt.end ? (
              <Thumb media={prompt.end} label="End frame" onRemove={remove(prompt.end)} large />
            ) : (
              <DropTile label="End frame" hint={uploadHint ?? 'Optional'} kinds={['image']} multiple={false} disabled={!uploadsEnabled} onFiles={add('end')} large />
            ))}
          {spec.start && spec.source && <Icon name="plus" className="frames-arrow" />}
          {spec.source &&
            (prompt.source ? (
              <Thumb media={prompt.source} label={prompt.mode === 'motion' ? 'Motion video' : 'Your video'} onRemove={remove(prompt.source)} large />
            ) : (
              <DropTile
                label={prompt.mode === 'motion' ? 'Motion video' : prompt.mode === 'swap' ? 'Source video' : 'Your video'}
                hint={uploadHint ?? 'Required · MP4 or MOV, up to 60 s'}
                kinds={['video']}
                multiple={false}
                disabled={!uploadsEnabled}
                onFiles={add('source')}
                large
              />
            ))}
        </div>
      )}
      {spec?.start && !spec.source && (
        <UrlAdder disabled={!!prompt.start && (!spec.end || !!prompt.end)} onAdd={(url) => actions.addImageUrl(prompt.id, prompt.start ? 'end' : 'start', url)} />
      )}

      {spec && refKinds.length > 0 && (
        <>
          {refTitle && <p className="field-label">{refTitle}</p>}
          <div className="references">
            {prompt.references.map((media, i) => (
              <Thumb
                key={media.id}
                media={media}
                label={`${KIND_LABEL[media.kind]} ${prompt.references.slice(0, i + 1).filter((r) => r.kind === media.kind).length}`}
                onRemove={remove(media)}
              />
            ))}
            {!refsFull && (
              <DropTile
                label={`Add ${refKinds.map((k) => (k === 'audio' ? 'audio' : `${k}s`)).join(', ').replace(/, ([^,]+)$/, ' or $1')}`}
                hint={uploadHint ?? counters}
                kinds={refKinds}
                multiple
                disabled={!uploadsEnabled}
                onFiles={add('references')}
              />
            )}
          </div>
          {limits.image && <UrlAdder disabled={prompt.references.filter((r) => r.kind === 'image').length >= limits.image.max} onAdd={(url) => actions.addImageUrl(prompt.id, 'references', url)} />}
        </>
      )}

      {spec?.soundtrack && (
        <div className="soundtrack">
          {prompt.soundtrack ? (
            <Thumb media={prompt.soundtrack} label="Audio track" onRemove={remove(prompt.soundtrack)} />
          ) : (
            <DropTile label="Audio track" hint={uploadHint ?? 'Optional · MP3, WAV, M4A'} kinds={['audio']} multiple={false} disabled={!uploadsEnabled} onFiles={add('soundtrack')} />
          )}
        </div>
      )}
    </div>
  );
}
