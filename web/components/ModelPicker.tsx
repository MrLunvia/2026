import { useMemo, useState } from 'react';
import type { VideoModel } from '../../shared/models.ts';
import { fromPerSecondCents } from '../../shared/pricing.ts';
import type { Pricing } from '../../shared/types.ts';
import { MODEL_BADGES, MODEL_FILTERS, makerGradient, modelChips, modelInitial, offeredModels, type ModelFilter } from '../modelInfo.ts';
import { Dialog } from './Dialog.tsx';
import { Icon } from './Icon.tsx';

export function ModelMark({ model, size = 40 }: { model: VideoModel; size?: number }) {
  return (
    <span className="model-mark" style={{ background: makerGradient(model.maker), width: size, height: size, fontSize: Math.round(size * 0.45) }} aria-hidden="true">
      {modelInitial(model)}
    </span>
  );
}

/** Inside of a model card; the caller picks the element (a picker button or a landing-page link). */
export function ModelCardBody({ model, fromCents, money }: { model: VideoModel; fromCents?: number; money: (cents: number) => string }) {
  const badge = MODEL_BADGES[model.id];
  return (
    <>
      <span className="model-card-top">
        <ModelMark model={model} />
        <span className="model-card-head">
          <strong>{model.name}</strong>
          <span className="muted">{model.maker}</span>
        </span>
        {badge && <span className={`model-badge is-${badge.toLowerCase()}`}>{badge}</span>}
      </span>
      <span className="model-card-text">{model.description}</span>
      <span className="model-chips">
        {modelChips(model).map((chip) => (
          <span key={chip} className="model-chip">
            {chip}
          </span>
        ))}
      </span>
      {fromCents !== undefined && <span className="model-price">from {money(fromCents)} / second</span>}
    </>
  );
}

function matches(model: VideoModel, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [model.name, model.maker, model.description, ...modelChips(model)].some((text) => text.toLowerCase().includes(q));
}

export function ModelPicker({
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
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ModelFilter>('all');
  const offered = useMemo(() => offeredModels(pricing.disabledModels), [pricing.disabledModels]);
  const test = MODEL_FILTERS.find((f) => f.id === filter)!.test;
  const shown = offered.filter((model) => test(model) && matches(model, query));

  return (
    <Dialog open={open} size="full" className="model-dialog" title="Choose a video model" onClose={onClose}>
      <div className="picker-tools">
        <label className="search">
          <Icon name="search" size={16} />
          <input className="input" type="search" placeholder={`Search ${offered.length} models`} value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search models" />
        </label>
        <div className="filters" role="group" aria-label="Filter models">
          {MODEL_FILTERS.map((f) => (
            <button key={f.id} type="button" aria-pressed={filter === f.id} className={filter === f.id ? 'filter is-active' : 'filter'} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="empty">
          <Icon name="search" size={28} />
          <p>No model matches that.</p>
        </div>
      ) : (
        <div className="model-grid">
          {shown.map((model) => (
            <button
              key={model.id}
              type="button"
              className={model.id === current ? 'model-card is-active' : 'model-card'}
              aria-pressed={model.id === current}
              onClick={() => onPick(model.id)}
            >
              <ModelCardBody model={model} fromCents={fromPerSecondCents(pricing, model.id)} money={money} />
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
