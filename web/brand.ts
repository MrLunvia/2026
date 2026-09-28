/** The owner's accent color (BRAND_COLOR) applied to the whole site, with a readable text color on top. */

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function applyBrandColor(color: string | undefined): void {
  const root = document.documentElement.style;
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
    root.removeProperty('--accent');
    root.removeProperty('--on-accent');
    return;
  }
  root.setProperty('--accent', color);
  // Dark text on light accents, white on dark ones (whichever contrasts more).
  root.setProperty('--on-accent', luminance(color) > 0.18 ? '#0a0a0b' : '#ffffff');
}
