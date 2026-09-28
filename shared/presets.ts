/**
 * Camera-move and look presets. Choosing one writes a plain sentence into the prompt, where the customer
 * can see and edit it; video models follow written camera and style directions, so nothing is hidden.
 */

export type PresetFamily = 'camera' | 'style';

export interface Preset {
  id: string;
  name: string;
  /** The sentence added to the prompt. Unique across all presets, so it can be found again. */
  phrase: string;
}

export const CAMERA_PRESETS: readonly Preset[] = [
  { id: 'static', name: 'Static', phrase: 'Camera: locked-off static shot on a tripod, no camera movement.' },
  { id: 'dolly-in', name: 'Dolly in', phrase: 'Camera: slow, smooth dolly-in toward the subject.' },
  { id: 'dolly-out', name: 'Dolly out', phrase: 'Camera: slow dolly-out, pulling back to reveal the surroundings.' },
  { id: 'crash-zoom', name: 'Crash zoom', phrase: 'Camera: sudden, fast crash zoom into the subject.' },
  { id: 'pan-left', name: 'Pan left', phrase: 'Camera: smooth, slow pan to the left across the scene.' },
  { id: 'pan-right', name: 'Pan right', phrase: 'Camera: smooth, slow pan to the right across the scene.' },
  { id: 'tilt-up', name: 'Tilt up', phrase: 'Camera: slow tilt upward, revealing what is above.' },
  { id: 'tilt-down', name: 'Tilt down', phrase: 'Camera: slow tilt downward, revealing what is below.' },
  { id: 'crane-up', name: 'Crane up', phrase: 'Camera: crane shot rising up and over the subject.' },
  { id: 'orbit', name: 'Orbit', phrase: 'Camera: smooth arc shot orbiting halfway around the subject.' },
  { id: 'orbit-360', name: '360° orbit', phrase: 'Camera: full 360-degree orbit around the subject.' },
  { id: 'tracking', name: 'Tracking', phrase: 'Camera: tracking shot moving alongside the subject as it moves.' },
  { id: 'handheld', name: 'Handheld', phrase: 'Camera: handheld, with subtle natural shake and a documentary feel.' },
  { id: 'fpv', name: 'FPV drone', phrase: 'Camera: fast FPV drone flight swooping low through the scene.' },
  { id: 'aerial', name: 'Aerial', phrase: 'Camera: high aerial drone shot gliding slowly over the landscape.' },
  { id: 'whip-pan', name: 'Whip pan', phrase: 'Camera: quick whip pan to the side with motion blur.' },
  { id: 'dolly-zoom', name: 'Dolly zoom', phrase: 'Camera: dolly zoom (vertigo effect), the background stretching while the subject stays the same size.' },
  { id: 'bullet-time', name: 'Bullet time', phrase: 'Camera: bullet time, the action frozen in slow motion as the camera circles it.' },
  { id: 'pov', name: 'First person', phrase: 'Camera: first-person POV, seen through the character’s eyes.' },
  { id: 'overhead', name: 'Top-down', phrase: 'Camera: top-down overhead shot looking straight down.' },
];

export const STYLE_PRESETS: readonly Preset[] = [
  { id: 'cinematic', name: 'Cinematic', phrase: 'Style: cinematic film look, anamorphic lens, shallow depth of field, rich color grading.' },
  { id: 'realistic', name: 'Photoreal', phrase: 'Style: ultra-realistic, natural lighting, true-to-life detail, shot on a high-end cinema camera.' },
  { id: 'anime', name: 'Anime', phrase: 'Style: Japanese anime, clean line art, vibrant cel-shaded colors.' },
  { id: '3d', name: '3D animation', phrase: 'Style: polished 3D animated feature film, soft lighting, expressive characters.' },
  { id: 'clay', name: 'Claymation', phrase: 'Style: stop-motion claymation, handcrafted clay textures, charmingly imperfect motion.' },
  { id: 'noir', name: 'Film noir', phrase: 'Style: black-and-white film noir, hard shadows, high contrast, moody atmosphere.' },
  { id: 'vintage', name: 'Vintage film', phrase: 'Style: vintage 16mm film, warm faded colors, soft grain and light leaks.' },
  { id: 'documentary', name: 'Documentary', phrase: 'Style: documentary realism, natural light, observational framing.' },
  { id: 'cyberpunk', name: 'Neon night', phrase: 'Style: neon cyberpunk night, rain-soaked streets, magenta and cyan glow.' },
  { id: 'fantasy', name: 'Fantasy', phrase: 'Style: epic fantasy, glowing magical light, rich painterly colors, grand scale.' },
  { id: 'horror', name: 'Horror', phrase: 'Style: eerie horror atmosphere, dim flickering light, deep shadows.' },
  { id: 'watercolor', name: 'Watercolor', phrase: 'Style: soft watercolor painting in motion, gentle washes of color, paper texture.' },
  { id: 'product', name: 'Product ad', phrase: 'Style: premium product commercial, clean studio lighting, glossy reflections, crisp detail.' },
  { id: 'golden-hour', name: 'Golden hour', phrase: 'Style: warm golden-hour sunlight, long soft shadows, glowing highlights.' },
  { id: 'vlog', name: 'Phone vlog', phrase: 'Style: smartphone vlog look, natural daylight, casual handheld framing, authentic social-media feel.' },
  { id: 'music-video', name: 'Music video', phrase: 'Style: stylish music video, bold colored lighting, energetic mood.' },
];

export const PRESETS: Record<PresetFamily, readonly Preset[]> = { camera: CAMERA_PRESETS, style: STYLE_PRESETS };

/** The preset of this family whose sentence is in the prompt, if any. */
export function presetIn(text: string, family: PresetFamily): Preset | undefined {
  return PRESETS[family].find((preset) => text.includes(preset.phrase));
}

/** The prompt with this family's sentence replaced by `preset`'s (or removed when `preset` is undefined). */
export function withPreset(text: string, family: PresetFamily, preset: Preset | undefined): string {
  let next = text;
  for (const { phrase } of PRESETS[family]) {
    if (next.includes(phrase)) next = next.split(phrase).join('');
  }
  // Tidy only the gap a removed sentence leaves; the customer's own text keeps its layout.
  if (next !== text) next = next.replace(/\n{3,}/g, '\n\n').replace(/^\s*\n/, '');
  next = next.replace(/\s+$/, '');
  if (!preset) return next;
  return next ? `${next}\n\n${preset.phrase}` : preset.phrase;
}
