import { CAMERA_PRESETS, STYLE_PRESETS } from '../../shared/presets.ts';
import { Icon } from './Icon.tsx';
import { Scene } from './Scene.tsx';

const phrase = (list: typeof CAMERA_PRESETS, id: string) => list.find((p) => p.id === id)?.phrase ?? '';

/** Starting points shown before a customer's first video. Each one fills a prompt, presets included. */
export const EXAMPLES: { title: string; text: string; camera: string; look: string }[] = [
  {
    title: 'Harbor at golden hour',
    text: 'Golden hour over a quiet harbor. The camera glides low across the water toward a lone fishing boat as gulls wheel overhead and the sun slips behind the hills.',
    camera: 'dolly-in',
    look: 'golden-hour',
  },
  {
    title: 'Neon rain',
    text: 'A woman in a yellow raincoat walks through a crowded Tokyo street at night, neon signs reflecting in the puddles, then turns toward the camera and smiles.',
    camera: 'tracking',
    look: 'cyberpunk',
  },
  {
    title: 'Mars walk',
    text: 'A lone astronaut crosses red desert dunes on Mars, dust swirling around their boots, two small moons low on the horizon.',
    camera: 'aerial',
    look: 'cinematic',
  },
  {
    title: 'Morning coffee ad',
    text: 'A steaming cup of coffee on a wooden café table, soft morning light through the window, steam curling slowly upward.',
    camera: 'orbit',
    look: 'product',
  },
  {
    title: 'Clay fox',
    text: 'A tiny clay fox explores a mossy forest floor and tilts its head at a glowing mushroom.',
    camera: 'static',
    look: 'clay',
  },
  {
    title: 'Cliffs at dawn',
    text: 'Waves crash against black volcanic cliffs at sunrise, sea spray catching the first light.',
    camera: 'fpv',
    look: 'realistic',
  },
];

export const exampleText = (example: (typeof EXAMPLES)[number]) =>
  `${example.text}\n\n${phrase(CAMERA_PRESETS, example.camera)}\n\n${phrase(STYLE_PRESETS, example.look)}`;

export function Inspiration({ onUse }: { onUse: (text: string) => void }) {
  return (
    <div className="inspiration">
      <div className="inspiration-head">
        <span className="inspiration-icon">
          <Icon name="film" size={22} />
        </span>
        <div>
          <h3>Your videos will appear here</h3>
          <p className="muted">Write a prompt on the left and press Generate, or start from one of these.</p>
        </div>
      </div>
      <div className="inspiration-grid">
        {EXAMPLES.map((example) => (
          <button key={example.title} type="button" className="inspiration-card" onClick={() => onUse(exampleText(example))}>
            <Scene camera={example.camera} look={example.look} playing />
            <span className="inspiration-text">
              <strong>{example.title}</strong>
              <span>{example.text}</span>
            </span>
            <span className="inspiration-use">
              <Icon name="wand" size={14} />
              Use this prompt
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
