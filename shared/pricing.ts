import type { GenerationSettings, Pricing } from './types.ts';

/** Price of one video; the server charges exactly what the page shows. */
export function videoPriceCents(settings: Pick<GenerationSettings, 'duration' | 'resolution'>, pricing: Pick<Pricing, 'perSecondCents'>): number {
  return settings.duration * (pricing.perSecondCents[settings.resolution] ?? 0);
}

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}
