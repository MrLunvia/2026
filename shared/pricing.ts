/** Prices and media summaries shared by the studio and the server, so both charge the same amount. */
import { DEFAULT_MODEL, billedSeconds, modelById, resolveEndpoint, type MediaCounts } from './models.ts';
import type { GenerationSettings, MediaInput, Pricing } from './types.ts';

/** Price per billed second for a model's quality, or undefined when it has none (or isn't offered). */
export function perSecondCents(pricing: Pick<Pricing, 'perSecond' | 'disabledModels'>, model: string, quality: string): number | undefined {
  if (pricing.disabledModels.includes(model)) return undefined;
  return pricing.perSecond[model]?.[quality];
}

export function mediaCounts(media: MediaInput): MediaCounts {
  return {
    mode: media.mode,
    start: !!media.startImageUrl,
    end: !!media.endImageUrl,
    source: !!media.sourceVideoUrl,
    soundtrack: !!media.soundtrackUrl,
    images: media.referenceImageUrls?.length ?? 0,
    videos: media.referenceVideoUrls?.length ?? 0,
    audios: media.referenceAudioUrls?.length ?? 0,
    sourceSeconds: media.sourceVideoSeconds,
    referenceVideoSeconds: media.referenceVideoSeconds ?? [],
  };
}

export interface Quote {
  /** Undefined when the prompt can't be made with these settings (see problems). */
  cents?: number;
  seconds: number;
  problems: string[];
}

/** What one prompt costs with these settings; `problems` explain why it can't be made. */
export function quote(pricing: Pick<Pricing, 'perSecond' | 'disabledModels'>, settings: GenerationSettings, media: MediaCounts, prompt: string): Quote {
  const { spec, problems } = resolveEndpoint(settings, media, prompt);
  if (!spec) return { seconds: 0, problems };
  const seconds = billedSeconds(spec, settings, media);
  const rate = perSecondCents(pricing, settings.model, settings.quality);
  if (rate === undefined) return { seconds, problems: [...problems, `${modelById(settings.model)?.name ?? 'This model'} isn't available right now`] };
  return { cents: seconds * rate, seconds, problems };
}

/** The headline price: a 30-second 720p video with the default model. */
export function headlinePriceCents(pricing: Pick<Pricing, 'perSecond'>): number {
  return 30 * (pricing.perSecond[DEFAULT_MODEL]?.['720p'] ?? 0);
}

/** Lowest price per second a model is offered at. */
export function fromPerSecondCents(pricing: Pick<Pricing, 'perSecond'>, model: string): number | undefined {
  const prices = Object.values(pricing.perSecond[model] ?? {}).filter((cents) => cents > 0);
  return prices.length > 0 ? Math.min(...prices) : undefined;
}

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
