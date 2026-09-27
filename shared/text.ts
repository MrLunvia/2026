/** Word counting and scene splitting for long prompts; shared so the UI and server agree. */

function isSpace(code: number): boolean {
  // Same set as JavaScript's \s.
  return (
    code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 ||
    code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff
  );
}

/** Words as editors count them: runs of non-whitespace. Allocation-free for very long prompts. */
export function countWords(text: string): number {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    if (isSpace(text.charCodeAt(i))) inWord = false;
    else if (!inWord) {
      inWord = true;
      count++;
    }
  }
  return count;
}

export interface Scene {
  title?: string;
  text: string;
}

// "Scene 3", "Shot 2:", "Scene: Beach", "# Heading", and uppercase sluglines ("INT. KITCHEN - NIGHT").
// A number or colon is required so prose such as "Shot on 35mm film" stays prose.
const HEADING = /^\s*(?:(?:scene|shot|sequence)\s*(?:#?\d+|:).*|#{1,6}\s+\S.*)$/i;
const SLUGLINE = /^\s*(?:INT|EXT|INT\/EXT|I\/E)\.\s*\S.*$/;
const SEPARATOR = /^\s*(?:-{3,}|\*{3,}|_{3,}|={3,})\s*$/;
const SENTENCE_END = /(?<=[.!?।॥。！？])\s+/u;

const isHeading = (line: string) => HEADING.test(line) || SLUGLINE.test(line);

/**
 * Split a long script into scene prompts of at most `maxWords` words. Scene headings and
 * `---` separators start new scenes; otherwise paragraphs are packed together. Oversized
 * parts are split at sentence ends, and a single oversized sentence at word boundaries.
 */
export function splitIntoScenes(text: string, maxWords: number): Scene[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const structured = lines.some((line) => isHeading(line) || SEPARATOR.test(line));
  const sections: Scene[] = [];

  if (structured) {
    let current: { title?: string; lines: string[] } = { lines: [] };
    const flush = () => {
      const body = current.lines.join('\n').trim();
      if (body) sections.push({ title: current.title, text: body });
    };
    for (const line of lines) {
      if (SEPARATOR.test(line)) {
        flush();
        current = { lines: [] };
      } else if (isHeading(line)) {
        flush();
        const heading = line.trim().replace(/^#{1,6}\s+/, '');
        current = { title: heading.slice(0, 80), lines: [heading] };
      } else {
        current.lines.push(line);
      }
    }
    flush();
  } else {
    // Pack consecutive paragraphs so short paragraphs don't each become a clip.
    let packed: string[] = [];
    let packedWords = 0;
    for (const paragraph of text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
      const words = countWords(paragraph);
      if (packed.length > 0 && packedWords + words > maxWords) {
        sections.push({ text: packed.join('\n\n') });
        packed = [];
        packedWords = 0;
      }
      packed.push(paragraph);
      packedWords += words;
    }
    if (packed.length > 0) sections.push({ text: packed.join('\n\n') });
  }

  const scenes: Scene[] = [];
  for (const section of sections) {
    const parts = countWords(section.text) <= maxWords ? [section.text] : splitLong(section.text, maxWords);
    parts.forEach((part, i) => {
      const title = section.title && parts.length > 1 ? `${section.title} (part ${i + 1})` : section.title;
      scenes.push({ title, text: part });
    });
  }
  return scenes;
}

function splitLong(text: string, maxWords: number): string[] {
  const parts: string[] = [];
  let current: string[] = [];
  let currentWords = 0;
  const push = () => {
    if (current.length > 0) parts.push(current.join(' '));
    current = [];
    currentWords = 0;
  };
  for (const sentence of text.split(SENTENCE_END).map((s) => s.trim()).filter(Boolean)) {
    const words = countWords(sentence);
    if (words > maxWords) {
      push();
      const tokens = sentence.split(/\s+/);
      for (let i = 0; i < tokens.length; i += maxWords) parts.push(tokens.slice(i, i + maxWords).join(' '));
      continue;
    }
    if (currentWords + words > maxWords) push();
    current.push(sentence);
    currentWords += words;
  }
  push();
  return parts;
}
