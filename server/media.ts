/**
 * Uploaded files: what they really are (from their bytes, not the declared type), how long a video
 * is (prices depend on it), and saving a request body to disk without holding it in memory.
 */
import { createWriteStream, promises as fs } from 'node:fs';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { MediaKind } from '../shared/models.ts';
import { HttpProblem } from './requests.ts';

export interface SniffedType {
  kind: MediaKind;
  contentType: string;
}

const AUDIO_BRANDS = new Set(['M4A ', 'M4B ', 'M4P ', 'F4A ']);

/** Identify an image, video or audio file from its first bytes; undefined for anything else. */
export function sniffMedia(head: Buffer): SniffedType | undefined {
  const text = (start: number, end: number) => head.toString('latin1', start, end);
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { kind: 'image', contentType: 'image/jpeg' };
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { kind: 'image', contentType: 'image/png' };
  if (head.length >= 6 && ['GIF87a', 'GIF89a'].includes(text(0, 6))) return { kind: 'image', contentType: 'image/gif' };
  if (head.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return { kind: 'image', contentType: 'image/webp' };
  if (head.length >= 12 && text(0, 4) === 'RIFF' && text(8, 12) === 'WAVE') return { kind: 'audio', contentType: 'audio/wav' };
  if (head.length >= 12 && text(4, 8) === 'ftyp') {
    const brand = text(8, 12);
    if (AUDIO_BRANDS.has(brand)) return { kind: 'audio', contentType: 'audio/mp4' };
    return { kind: 'video', contentType: brand === 'qt  ' ? 'video/quicktime' : 'video/mp4' };
  }
  if (head.length >= 3 && text(0, 3) === 'ID3') return { kind: 'audio', contentType: 'audio/mpeg' };
  if (head.length >= 2 && head[0] === 0xff && (head[1]! & 0xe0) === 0xe0) {
    // MPEG audio frame sync: layer bits 00 are AAC (ADTS), anything else MP3.
    return { kind: 'audio', contentType: (head[1]! & 0x06) === 0 ? 'audio/aac' : 'audio/mpeg' };
  }
  return undefined;
}

/** True for containers we can't measure, so the customer is told to use MP4 or MOV. */
export function isUnsupportedVideo(head: Buffer): boolean {
  return head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3; // WebM / Matroska
}

/** Length of an MP4/MOV/M4A file from its movie header (moov/mvhd), or undefined if unreadable. */
export async function mp4Duration(file: string): Promise<number | undefined> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const header = Buffer.alloc(16);
    const box = async (offset: number, limit: number) => {
      const { bytesRead } = await handle.read(header, 0, 16, offset);
      if (bytesRead < 8) return undefined;
      let length = header.readUInt32BE(0);
      let headerLength = 8;
      if (length === 1) {
        if (bytesRead < 16) return undefined;
        length = Number(header.readBigUInt64BE(8));
        headerLength = 16;
      } else if (length === 0) {
        length = limit - offset;
      }
      if (length < headerLength || offset + length > limit) return undefined;
      return { type: header.toString('latin1', 4, 8), length, headerLength };
    };
    // Real files have a handful of boxes; the caps keep a crafted file from making us read forever.
    let steps = 0;
    for (let offset = 0; offset + 8 <= size && steps++ < 1000; ) {
      const top = await box(offset, size);
      if (!top) return undefined;
      if (top.type === 'moov') {
        const end = offset + top.length;
        for (let inner = offset + top.headerLength; inner + 8 <= end && steps++ < 2000; ) {
          const child = await box(inner, end);
          if (!child) return undefined;
          if (child.type === 'mvhd') {
            const body = Buffer.alloc(32);
            await handle.read(body, 0, 32, inner + child.headerLength);
            const version = body[0];
            const timescale = version === 1 ? body.readUInt32BE(20) : body.readUInt32BE(12);
            const duration = version === 1 ? Number(body.readBigUInt64BE(24)) : body.readUInt32BE(16);
            const seconds = timescale > 0 ? duration / timescale : NaN;
            return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) / 1000 : undefined;
          }
          inner += child.length;
        }
        return undefined;
      }
      offset += top.length;
    }
    return undefined;
  } finally {
    await handle.close();
  }
}

/** Stream a request body to `file`, refusing (413) once it passes `limit` bytes. Returns the size. */
export async function saveBody(body: Readable, file: string, limit: number): Promise<number> {
  let size = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > limit) done(new HttpProblem(413, `Files can be up to ${Math.round(limit / 1024 / 1024)} MB`));
      else done(null, chunk);
    },
  });
  await pipeline(body, counter, createWriteStream(file));
  return size;
}

export async function readHead(file: string, bytes = 64): Promise<Buffer> {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
