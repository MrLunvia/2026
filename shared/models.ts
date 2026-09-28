/**
 * Every video model the platform offers and exactly how each Higgsfield endpoint takes its input.
 * Paths, fields, limits and options follow Higgsfield's published input schemas (docs.higgsfield.ai,
 * as of 2026-09-26). Shared by the server (validation, request bodies, prices) and the studio (controls),
 * so the page never offers something the server would refuse.
 */

import { ASPECT_RATIOS } from './options.ts';

export type MediaKind = 'image' | 'video' | 'audio';

/** How one prompt uses media. A model offers the ones its endpoints support. */
export type InputType = 'text' | 'frames' | 'references' | 'edit' | 'extend' | 'motion' | 'swap' | 'video-reference';
export const INPUT_TYPES: readonly InputType[] = ['text', 'frames', 'references', 'edit', 'extend', 'motion', 'swap', 'video-reference'];

interface ListSpec {
  field: string;
  /** Fewest items the endpoint needs (0 = optional). */
  min: number;
  max: number;
}

export interface EndpointSpec {
  /** API path: POST https://api.higgsfield.ai/<path> */
  path: string;
  /** Whether a text prompt is required. */
  prompt: boolean;
  promptMaxChars?: number;
  /** Absent when the video's length comes from the uploaded video (edit, motion, swap). */
  duration?: { min: number; max: number } | { options: readonly number[] };
  /** Sends `resolution` (the quality's value) when set. */
  resolutions?: readonly string[];
  /** Sends `aspect_ratio` when set; absent means framing follows the input image or video. */
  aspectRatios?: readonly string[];
  audio?: 'generate_audio' | 'sound' | 'keep_original_sound';
  /** Kling O1/O3 take the quality tier in a `mode` field. */
  tiers?: readonly string[];
  start?: { field: string };
  end?: { field: string };
  images?: ListSpec;
  videos?: ListSpec;
  audios?: ListSpec;
  /** The video to edit, extend or take motion from; `list` sends it as a one-item array. */
  source?: { field: string; list?: boolean };
  /** Optional single audio track. */
  soundtrack?: { field: string };
  /** A reference of one of these kinds is required. */
  needs?: readonly MediaKind[];
  maxTotalRefs?: number;
  /**
   * Which seconds are billed: the new video's, the uploaded video's, or both. Uploaded reference
   * videos always add their length, mirroring how Higgsfield bills video input.
   */
  billing: 'output' | 'source' | 'source+output';
}

export interface Quality {
  /** Unique within the model; also the pricing key. */
  id: string;
  label: string;
  /** Value sent as `resolution`, for endpoints that take one. */
  resolution?: string;
  /** Value sent as Kling's `mode` tier. */
  tier?: string;
  inputs: Partial<Record<InputType, EndpointSpec>>;
}

export interface VideoModel {
  id: string;
  name: string;
  maker: string;
  description: string;
  qualities: Quality[];
  defaultQuality: string;
  /** Starting price per billed second (currency minor units) for each quality; the admin can change it. */
  defaultPrices: Record<string, number>;
  /** Labels that differ from the generic ones, e.g. Kling's "Motion control". */
  inputLabels?: Partial<Record<InputType, string>>;
}

const AR6 = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;
const AR5 = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
const AR3 = ['16:9', '9:16', '1:1'] as const;
const range = (min: number, max: number) => ({ min, max });
const list = (field: string, max: number, min = 0): ListSpec => ({ field, min, max });

// ---- endpoint families ----------------------------------------------------------------------

function seedance25(): Quality['inputs'] {
  const base = { duration: range(4, 30), resolutions: ['480p', '720p'], audio: 'generate_audio' } as const;
  const refs = { images: list('image_urls', 30), videos: list('video_urls', 10), audios: list('audio_urls', 10) };
  // The source video counts toward the 10-video limit of edit and extend.
  const editRefs = { images: list('image_urls', 30), videos: list('video_urls', 9), audios: list('audio_urls', 10) };
  const p = 'bytedance/seedance-2.5';
  return {
    text: { path: `${p}/text-to-video`, prompt: true, ...base, aspectRatios: AR6, billing: 'output' },
    frames: { path: `${p}/image-to-video`, prompt: false, ...base, start: { field: 'image_url' }, end: { field: 'end_image_url' }, billing: 'output' },
    references: { path: `${p}/reference-to-video`, prompt: false, ...base, aspectRatios: AR6, ...refs, needs: ['image', 'video', 'audio'], billing: 'output' },
    edit: { path: `${p}/video-edit`, prompt: true, resolutions: base.resolutions, audio: base.audio, source: { field: 'video_url' }, ...editRefs, billing: 'source' },
    extend: { path: `${p}/video-extend`, prompt: true, ...base, source: { field: 'video_url' }, ...editRefs, billing: 'source+output' },
  };
}

function seedance20(): Quality['inputs'] {
  const base = { duration: range(4, 15), resolutions: ['480p', '720p', '1080p', '4k'], audio: 'generate_audio' } as const;
  const p = 'bytedance/seedance-2.0';
  return {
    text: { path: `${p}/text-to-video`, prompt: true, ...base, aspectRatios: AR6, billing: 'output' },
    frames: { path: `${p}/image-to-video`, prompt: false, ...base, start: { field: 'image_url' }, end: { field: 'end_image_url' }, billing: 'output' },
    references: {
      path: `${p}/reference-to-video`,
      prompt: false,
      ...base,
      aspectRatios: AR6,
      images: list('image_urls', 9),
      videos: list('video_urls', 3),
      audios: list('audio_urls', 3),
      needs: ['image', 'video', 'audio'],
      billing: 'output',
    },
  };
}

function klingMotion(path: string): EndpointSpec {
  // The character image plus the video whose motion it copies; the result is as long as that video.
  return { path, prompt: false, audio: 'keep_original_sound', start: { field: 'image_url' }, source: { field: 'video_url' }, billing: 'source' };
}

function kling30(tier: 'std' | 'pro' | '4k'): Quality['inputs'] {
  const base = { duration: range(3, 15), audio: 'sound' } as const;
  return {
    text: { path: `kling-video/v3.0/${tier}/text-to-video`, prompt: true, ...base, aspectRatios: AR3, billing: 'output' },
    frames: { path: `kling-video/v3.0/${tier}/image-to-video`, prompt: false, ...base, start: { field: 'image_url' }, end: { field: 'last_image_url' }, billing: 'output' },
    ...(tier === '4k' ? {} : { motion: klingMotion(`kling-video/v3/motion-control/${tier}`) }),
  };
}

function kling30Turbo(): Quality['inputs'] {
  const base = { prompt: true, duration: range(3, 15), resolutions: ['720p', '1080p'] } as const;
  return {
    text: { path: 'kling-video/v3.0-turbo/text-to-video', ...base, aspectRatios: AR3, billing: 'output' },
    frames: { path: 'kling-video/v3.0-turbo/image-to-video', ...base, start: { field: 'image_url' }, billing: 'output' },
  };
}

function klingOmni(): Quality['inputs'] {
  const tiers = ['std', 'pro'] as const;
  const p = 'kling-video/omni';
  return {
    text: { path: `${p}/image-reference`, prompt: true, tiers, duration: range(3, 10), aspectRatios: AR3, billing: 'output' },
    frames: {
      path: `${p}/first-last-frame`,
      prompt: true,
      tiers,
      duration: { options: [5, 10] },
      aspectRatios: AR3,
      start: { field: 'first_frame_url' },
      end: { field: 'last_frame_url' },
      billing: 'output',
    },
    references: { path: `${p}/image-reference`, prompt: true, tiers, duration: range(3, 10), aspectRatios: AR3, images: list('image_urls', 7, 1), billing: 'output' },
    edit: { path: `${p}/video-edit`, prompt: true, tiers, source: { field: 'video_urls', list: true }, images: list('image_urls', 4), billing: 'source' },
    'video-reference': {
      path: `${p}/video-reference`,
      prompt: true,
      tiers,
      duration: range(3, 10),
      aspectRatios: AR3,
      source: { field: 'video_urls', list: true },
      images: list('image_urls', 4),
      billing: 'source+output',
    },
  };
}

function klingO3(tier: 'std' | 'pro' | '4k'): Quality['inputs'] {
  const tiers = ['std', 'pro', '4k'] as const;
  const p = 'kling-video/o3';
  const base = { tiers, duration: range(3, 15), aspectRatios: AR3, audio: 'sound' } as const;
  return {
    text: { path: `${p}/image-reference`, prompt: true, ...base, billing: 'output' },
    frames: { path: `${p}/first-last-frame`, prompt: false, ...base, start: { field: 'first_frame_url' }, end: { field: 'last_frame_url' }, billing: 'output' },
    references: { path: `${p}/image-reference`, prompt: false, ...base, images: list('image_urls', 7, 1), billing: 'output' },
    edit: { path: `${p}/video-edit`, prompt: true, tiers, source: { field: 'video_urls', list: true }, images: list('image_urls', 4), billing: 'source' },
    ...(tier === '4k'
      ? {}
      : {
          'video-reference': {
            path: `${p}/video-reference`,
            prompt: true,
            tiers: ['std', 'pro'],
            duration: range(3, 10),
            aspectRatios: AR3,
            source: { field: 'video_urls', list: true },
            images: list('image_urls', 4),
            billing: 'source+output',
          } satisfies EndpointSpec,
        }),
  };
}

function wan30(p: string): Quality['inputs'] {
  const base = { duration: range(2, 30), resolutions: ['480p', '720p', '1080p'], audio: 'generate_audio' } as const;
  const aspectRatios = [...AR5, 'adaptive'];
  return {
    text: { path: `${p}/text-to-video`, prompt: true, ...base, aspectRatios, billing: 'output' },
    // Framing follows the image (the endpoint's default aspect ratio is "adaptive").
    frames: { path: `${p}/image-to-video`, prompt: true, ...base, start: { field: 'image_url' }, end: { field: 'end_image_url' }, billing: 'output' },
    references: {
      path: `${p}/reference-to-video`,
      prompt: true,
      ...base,
      aspectRatios,
      images: list('image_urls', 10),
      videos: list('video_urls', 5),
      audios: list('audio_urls', 5),
      needs: ['image', 'video', 'audio'],
      billing: 'output',
    },
  };
}

function genjutsu(): Quality['inputs'] {
  const base = {
    prompt: false,
    promptMaxChars: 10_000,
    resolutions: ['720p', '480p'],
    source: { field: 'video_url' },
    images: list('image_urls', 8, 1),
    billing: 'source',
  } as const;
  return {
    motion: { path: 'higgsfield/genjutsu/motion-transfer/v1.0', ...base },
    swap: { path: 'higgsfield/genjutsu/object-swap/v1.0', ...base },
  };
}

function cinemaStudio(): Quality['inputs'] {
  const base = { path: 'higgsfield/cinema-studio/4.0', prompt: true, duration: range(4, 30), resolutions: ['480p', '720p'], aspectRatios: AR6, audio: 'generate_audio' } as const;
  return {
    text: { ...base, billing: 'output' },
    references: { ...base, images: list('image_urls', 30), videos: list('video_urls', 10), audios: list('audio_urls', 10), needs: ['image', 'video', 'audio'], billing: 'output' },
  };
}

function hailuo(): Quality['inputs'] {
  const base = { prompt: true, duration: { options: [6, 10] } } as const;
  return {
    text: { path: 'minimax/hailuo-2.3/standard/text-to-video', ...base, billing: 'output' },
    frames: { path: 'minimax/hailuo-2.3/standard/image-to-video', ...base, start: { field: 'image_url' }, billing: 'output' },
  };
}

function wan26(resolution: string): Quality['inputs'] {
  const soundtrack = { field: 'audio_url' };
  const hd = resolution !== '480p';
  return {
    ...(hd && {
      text: { path: 'wan/v2.6/text-to-video', prompt: true, duration: { options: [5, 10, 15] }, resolutions: ['720p', '1080p'], soundtrack, billing: 'output' } satisfies EndpointSpec,
    }),
    frames: {
      path: 'wan/v2.6/image-to-video',
      prompt: true,
      duration: { options: [5, 10, 15] },
      resolutions: ['480p', '720p', '1080p'],
      start: { field: 'image_url' },
      soundtrack,
      billing: 'output',
    },
    ...(hd && {
      references: {
        path: 'wan/v2.6/reference-to-video',
        prompt: true,
        duration: { options: [5, 10] },
        resolutions: ['720p', '1080p'],
        aspectRatios: AR5,
        videos: list('video_urls', 3, 1),
        needs: ['video'],
        billing: 'output',
      } satisfies EndpointSpec,
    }),
  };
}

function wan27(): Quality['inputs'] {
  const base = { resolutions: ['720p', '1080p'] } as const;
  const soundtrack = { field: 'audio_url' };
  return {
    text: { path: 'wan/v2.7/text-to-video', prompt: true, ...base, duration: range(2, 15), aspectRatios: AR5, soundtrack, billing: 'output' },
    frames: { path: 'wan/v2.7/image-to-video', prompt: false, ...base, duration: range(2, 15), start: { field: 'image_url' }, end: { field: 'end_image_url' }, soundtrack, billing: 'output' },
    references: {
      path: 'wan/v2.7/reference-to-video',
      prompt: true,
      ...base,
      duration: range(2, 10),
      aspectRatios: ['16:9', '9:16'],
      images: list('image_urls', 5),
      videos: list('video_urls', 3),
      needs: ['image', 'video'],
      billing: 'output',
    },
  };
}

function happyHorse(p: string): Quality['inputs'] {
  const resolutions = ['720p', '1080p'] as const;
  return {
    text: { path: `${p}/text-to-video`, prompt: true, duration: range(3, 15), resolutions, aspectRatios: AR5, billing: 'output' },
    frames: { path: `${p}/image-to-video`, prompt: false, duration: range(2, 15), resolutions, start: { field: 'image_url' }, billing: 'output' },
    references: { path: `${p}/reference-to-video`, prompt: true, duration: range(2, 15), resolutions, images: list('image_urls', 5, 1), billing: 'output' },
  };
}

function minimaxH3(): Quality['inputs'] {
  // Only 2K exists, which is also the default, so `resolution` is not sent.
  const base = { prompt: true, duration: range(5, 15) } as const;
  const aspectRatios = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'];
  return {
    text: { path: 'minimax/h3/text-to-video', ...base, aspectRatios, billing: 'output' },
    frames: { path: 'minimax/h3/image-to-video', ...base, start: { field: 'image_url' }, end: { field: 'end_image_url' }, billing: 'output' },
    references: {
      path: 'minimax/h3/reference-to-video',
      ...base,
      aspectRatios,
      images: list('image_urls', 9),
      videos: list('video_urls', 3),
      audios: list('audio_urls', 3),
      needs: ['image', 'video'],
      maxTotalRefs: 12,
      billing: 'output',
    },
  };
}

function ltx(variant: 'fast' | 'pro'): Quality['inputs'] {
  const base = {
    prompt: true,
    promptMaxChars: 5000,
    duration: { options: [6, 8, 10] },
    resolutions: variant === 'fast' ? ['720p', '1080p', '2k', '4k'] : ['720p', '1080p'],
    aspectRatios: ['16:9', '9:16'],
    audio: 'generate_audio',
  } as const;
  return {
    text: { path: `lightricks/ltx-2.5/text-to-video/${variant}`, ...base, billing: 'output' },
    frames: { path: `lightricks/ltx-2.5/image-to-video/${variant}`, ...base, start: { field: 'image_url' }, end: { field: 'end_image_url' }, billing: 'output' },
  };
}

function pixverse(): Quality['inputs'] {
  const base = { prompt: true, promptMaxChars: 5000, duration: range(1, 15), resolutions: ['360p', '540p', '720p', '1080p'], audio: 'generate_audio' } as const;
  return {
    text: { path: 'pixverse/v6/text-to-video', ...base, aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16'], billing: 'output' },
    frames: { path: 'pixverse/v6/image-to-video', ...base, start: { field: 'image_url' }, end: { field: 'end_image_url' }, billing: 'output' },
  };
}

function grok(): Quality['inputs'] {
  // One endpoint: a prompt alone, a start image, or reference images, each with an optional audio track.
  const base = {
    path: 'xai/grok-imagine-video/v1.5/reference-to-video',
    prompt: true,
    duration: range(1, 15),
    resolutions: ['480p', '720p', '1080p'],
    soundtrack: { field: 'audio_url' },
  } as const;
  const aspectRatios = ['auto', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16'];
  return {
    text: { ...base, aspectRatios, billing: 'output' },
    frames: { ...base, start: { field: 'image_url' }, billing: 'output' },
    references: { ...base, aspectRatios, images: list('image_urls', 7, 1), billing: 'output' },
  };
}

// ---- the catalog ----------------------------------------------------------------------------

const byResolution = (resolutions: string[], inputs: (resolution: string) => Quality['inputs']): Quality[] =>
  resolutions.map((resolution) => ({ id: resolution, label: resolution === '2k' || resolution === '4k' ? resolution.toUpperCase() : resolution, resolution, inputs: inputs(resolution) }));

export const MODELS: readonly VideoModel[] = [
  {
    id: 'seedance-2.5',
    name: 'Seedance 2.5',
    maker: 'ByteDance',
    description: 'Cinematic 30-second videos with sound; references, edit and extend.',
    qualities: byResolution(['480p', '720p'], seedance25),
    defaultQuality: '720p',
    defaultPrices: { '480p': 30, '720p': 40 },
  },
  {
    id: 'seedance-2.0',
    name: 'Seedance 2.0',
    maker: 'ByteDance',
    description: 'Up to 4K, with image, video and audio references.',
    qualities: byResolution(['480p', '720p', '1080p', '4k'], seedance20),
    defaultQuality: '720p',
    defaultPrices: { '480p': 30, '720p': 60, '1080p': 140, '4k': 320 },
  },
  {
    id: 'kling-3.0',
    name: 'Kling 3.0',
    maker: 'Kuaishou',
    description: 'Sharp motion with native audio; Standard, Pro, 4K and Turbo, plus motion control.',
    qualities: [
      { id: 'std', label: 'Standard', inputs: kling30('std') },
      { id: 'pro', label: 'Pro', inputs: kling30('pro') },
      { id: '4k', label: '4K', inputs: kling30('4k') },
      { id: 'turbo-720p', label: 'Turbo 720p', resolution: '720p', inputs: kling30Turbo() },
      { id: 'turbo-1080p', label: 'Turbo 1080p', resolution: '1080p', inputs: kling30Turbo() },
    ],
    defaultQuality: 'std',
    defaultPrices: { std: 25, pro: 35, '4k': 85, 'turbo-720p': 30, 'turbo-1080p': 40 },
    inputLabels: { motion: 'Motion control' },
  },
  {
    id: 'kling-2.6',
    name: 'Kling 2.6',
    maker: 'Kuaishou',
    description: 'Cinematic motion and physics with sound; motion control.',
    qualities: [
      {
        id: 'pro',
        label: 'Pro',
        inputs: {
          text: { path: 'kling-video/v2.6/pro/text-to-video', prompt: true, duration: { options: [5, 10] }, aspectRatios: AR3, audio: 'sound', billing: 'output' },
          frames: { path: 'kling-video/v2.6/pro/image-to-video', prompt: true, duration: { options: [5, 10] }, audio: 'sound', start: { field: 'image_url' }, billing: 'output' },
          motion: klingMotion('kling-video/motion-control/pro'),
        },
      },
      { id: 'std', label: 'Standard', inputs: { motion: klingMotion('kling-video/motion-control/std') } },
    ],
    defaultQuality: 'pro',
    defaultPrices: { pro: 30, std: 25 },
    inputLabels: { motion: 'Motion control' },
  },
  {
    id: 'kling-2.5',
    name: 'Kling 2.5 Turbo',
    maker: 'Kuaishou',
    description: 'Fast, affordable 5 or 10-second clips.',
    qualities: [
      {
        id: 'pro',
        label: 'Pro',
        inputs: {
          text: { path: 'kling-video/v2.5-turbo/pro/text-to-video', prompt: true, duration: { options: [5, 10] }, billing: 'output' },
          frames: { path: 'kling-video/v2.5-turbo/pro/image-to-video', prompt: true, duration: { options: [5, 10] }, start: { field: 'image_url' }, billing: 'output' },
        },
      },
      {
        id: 'std',
        label: 'Standard',
        inputs: {
          frames: { path: 'kling-video/v2.5-turbo/standard/image-to-video', prompt: true, duration: { options: [5, 10] }, start: { field: 'image_url' }, billing: 'output' },
        },
      },
    ],
    defaultQuality: 'pro',
    defaultPrices: { pro: 20, std: 15 },
  },
  {
    id: 'kling-o1',
    name: 'Kling O1 (Omni)',
    maker: 'Kuaishou',
    description: 'One model for frames, image references, video references and video edits.',
    qualities: [
      { id: 'std', label: 'Standard', tier: 'std', inputs: klingOmni() },
      { id: 'pro', label: 'Pro', tier: 'pro', inputs: klingOmni() },
    ],
    defaultQuality: 'pro',
    defaultPrices: { std: 25, pro: 35 },
  },
  {
    id: 'kling-o3',
    name: 'Kling O3',
    maker: 'Kuaishou',
    description: 'Kling’s newest all-in-one model, up to 4K, with sound.',
    qualities: [
      { id: 'std', label: 'Standard', tier: 'std', inputs: klingO3('std') },
      { id: 'pro', label: 'Pro', tier: 'pro', inputs: klingO3('pro') },
      { id: '4k', label: '4K', tier: '4k', inputs: klingO3('4k') },
    ],
    defaultQuality: 'pro',
    defaultPrices: { std: 25, pro: 35, '4k': 85 },
  },
  {
    id: 'wan-3.0-prime',
    name: 'Wan 3.0 Prime',
    maker: 'Alibaba',
    description: 'Wan’s best quality: up to 30 seconds at 1080p with native audio.',
    qualities: byResolution(['480p', '720p', '1080p'], () => wan30('alibaba/wan-3.0-prime')),
    defaultQuality: '1080p',
    defaultPrices: { '480p': 15, '720p': 30, '1080p': 55 },
  },
  {
    id: 'wan-3.0',
    name: 'Wan 3.0',
    maker: 'Alibaba',
    description: 'Up to 30 seconds at 1080p with audio and multimodal references.',
    qualities: byResolution(['480p', '720p', '1080p'], () => wan30('alibaba/wan-3.0')),
    defaultQuality: '1080p',
    defaultPrices: { '480p': 10, '720p': 20, '1080p': 40 },
  },
  {
    id: 'genjutsu',
    name: 'Genjutsu',
    maker: 'Higgsfield',
    description: 'Transfer a video’s motion to new characters, or swap objects in a video.',
    qualities: byResolution(['480p', '720p'], genjutsu),
    defaultQuality: '720p',
    defaultPrices: { '480p': 65, '720p': 140 },
    inputLabels: { motion: 'Motion transfer' },
  },
  {
    id: 'cinema-studio-4.0',
    name: 'Cinema Studio 4.0',
    maker: 'Higgsfield',
    description: 'Film-grade looks up to 30 seconds, with image, video and audio references.',
    qualities: byResolution(['480p', '720p'], cinemaStudio),
    defaultQuality: '720p',
    defaultPrices: { '480p': 45, '720p': 95 },
  },
  {
    id: 'hailuo-2.3',
    name: 'MiniMax Hailuo 2.3',
    maker: 'MiniMax',
    description: 'Natural physics and facial emotion at a low price.',
    qualities: [{ id: 'standard', label: 'Standard', inputs: hailuo() }],
    defaultQuality: 'standard',
    defaultPrices: { standard: 10 },
  },
  {
    id: 'wan-2.6',
    name: 'Wan 2.6',
    maker: 'Alibaba',
    description: 'Stylized, creative clips; video-to-video references.',
    qualities: byResolution(['480p', '720p', '1080p'], wan26),
    defaultQuality: '720p',
    defaultPrices: { '480p': 15, '720p': 20, '1080p': 30 },
  },
  {
    id: 'wan-2.7',
    name: 'Wan 2.7',
    maker: 'Alibaba',
    description: 'Character-consistent videos with synchronized sound.',
    qualities: byResolution(['720p', '1080p'], wan27),
    defaultQuality: '720p',
    defaultPrices: { '720p': 20, '1080p': 30 },
  },
  {
    id: 'happy-horse-1.0',
    name: 'Happy Horse 1.0',
    maker: 'Alibaba',
    description: 'Text, image and reference videos up to 15 seconds.',
    qualities: byResolution(['720p', '1080p'], () => happyHorse('alibaba/happy-horse')),
    defaultQuality: '720p',
    defaultPrices: { '720p': 30, '1080p': 40 },
  },
  {
    id: 'happy-horse-1.1',
    name: 'Happy Horse 1.1',
    maker: 'Alibaba',
    description: 'The newer Happy Horse, 1080p by default.',
    qualities: byResolution(['720p', '1080p'], () => happyHorse('alibaba/happy-horse/v1.1')),
    defaultQuality: '1080p',
    defaultPrices: { '720p': 30, '1080p': 40 },
  },
  {
    id: 'minimax-h3',
    name: 'MiniMax H3',
    maker: 'MiniMax',
    description: '2K videos with keyframes or image, video and audio references.',
    qualities: [{ id: '2k', label: '2K', inputs: minimaxH3() }],
    defaultQuality: '2k',
    defaultPrices: { '2k': 30 },
  },
  {
    id: 'ltx-2.5-fast',
    name: 'LTX 2.5 Fast',
    maker: 'Lightricks',
    description: 'Quick 6 to 10-second clips, up to 4K.',
    qualities: byResolution(['720p', '1080p', '2k', '4k'], () => ltx('fast')),
    defaultQuality: '1080p',
    defaultPrices: { '720p': 20, '1080p': 30, '2k': 60, '4k': 100 },
  },
  {
    id: 'ltx-2.5-pro',
    name: 'LTX 2.5 Pro',
    maker: 'Lightricks',
    description: 'Higher-fidelity LTX at 720p or 1080p.',
    qualities: byResolution(['720p', '1080p'], () => ltx('pro')),
    defaultQuality: '1080p',
    defaultPrices: { '720p': 25, '1080p': 40 },
  },
  {
    id: 'pixverse-6',
    name: 'PixVerse 6',
    maker: 'PixVerse',
    description: 'Stylish 1 to 15-second clips with sound, 360p to 1080p.',
    qualities: byResolution(['360p', '540p', '720p', '1080p'], pixverse),
    defaultQuality: '720p',
    defaultPrices: { '360p': 15, '540p': 20, '720p': 25, '1080p': 35 },
  },
  {
    id: 'grok-imagine-1.5',
    name: 'Grok Imagine Video 1.5',
    maker: 'xAI',
    description: 'From text, a start image or up to 7 references, with an optional audio track.',
    qualities: byResolution(['480p', '720p', '1080p'], grok),
    defaultQuality: '720p',
    defaultPrices: { '480p': 20, '720p': 30, '1080p': 45 },
  },
];

export const DEFAULT_MODEL = 'seedance-2.5';

const MODEL_INDEX = new Map(MODELS.map((model) => [model.id, model]));
export const modelById = (id: string): VideoModel | undefined => MODEL_INDEX.get(id);
export const qualityOf = (model: VideoModel, id: string): Quality | undefined => model.qualities.find((q) => q.id === id);

export const INPUT_LABELS: Record<InputType, string> = {
  text: 'Text only',
  frames: 'Start / end frame',
  references: 'References',
  edit: 'Edit a video',
  extend: 'Extend a video',
  motion: 'Motion',
  swap: 'Object swap',
  'video-reference': 'Video reference',
};

export const inputLabel = (model: VideoModel, input: InputType): string => model.inputLabels?.[input] ?? INPUT_LABELS[input];

/** Input types any quality of the model offers, in display order. */
export function modelInputs(model: VideoModel): InputType[] {
  return INPUT_TYPES.filter((input) => model.qualities.some((q) => q.inputs[input]));
}

export function endpointFor(selection: { model: string; quality: string }, input: InputType): EndpointSpec | undefined {
  const model = modelById(selection.model);
  return model ? qualityOf(model, selection.quality)?.inputs[input] : undefined;
}

export interface ModelControls {
  inputs: InputType[];
  /** Absent when every video's length comes from an uploaded video. */
  duration?: { min: number; max: number } | { options: number[] };
  /** Ratios offered for this model ("auto" when it can follow the input). */
  aspectRatios: string[];
  audio: boolean;
}

/** What the settings panel offers for a model at a quality: everything any of its input types accepts. */
export function modelControls(model: VideoModel, qualityId: string): ModelControls {
  const quality = qualityOf(model, qualityId) ?? qualityOf(model, model.defaultQuality)!;
  const specs = Object.values(quality.inputs);
  const durations = specs.flatMap((spec) => (spec.duration ? [spec.duration] : []));
  let duration: ModelControls['duration'];
  if (durations.length > 0 && durations.every((d) => 'options' in d)) {
    duration = { options: [...new Set(durations.flatMap((d) => ('options' in d ? d.options : [])))].sort((a, b) => a - b) };
  } else if (durations.length > 0) {
    const low = durations.map((d) => ('options' in d ? Math.min(...d.options) : d.min));
    const high = durations.map((d) => ('options' in d ? Math.max(...d.options) : d.max));
    duration = { min: Math.min(...low), max: Math.max(...high) };
  }
  const ratios = new Set(specs.flatMap((spec) => (spec.aspectRatios ?? []).map((r) => (r === 'adaptive' ? 'auto' : r))));
  return {
    inputs: INPUT_TYPES.filter((input) => quality.inputs[input]),
    duration,
    aspectRatios: ASPECT_RATIOS.filter((r) => ratios.has(r)),
    audio: specs.some((spec) => spec.audio),
  };
}

// ---- choosing and checking ------------------------------------------------------------------

/** What the checks and prices need to know about a prompt's media. */
export interface MediaCounts {
  mode: InputType;
  start: boolean;
  end: boolean;
  source: boolean;
  soundtrack: boolean;
  images: number;
  videos: number;
  audios: number;
  /** Length of the uploaded source video. */
  sourceSeconds?: number;
  /** Lengths of uploaded reference videos. */
  referenceVideoSeconds: number[];
}

export interface Selection {
  model: string;
  quality: string;
  duration: number;
  aspectRatio: string;
  generateAudio: boolean;
}

export function durationFits(spec: EndpointSpec, seconds: number): boolean {
  const d = spec.duration;
  if (!d) return true;
  return 'options' in d ? d.options.includes(seconds) : Number.isInteger(seconds) && seconds >= d.min && seconds <= d.max;
}

export function describeDuration(spec: EndpointSpec): string {
  const d = spec.duration;
  if (!d) return 'the uploaded video’s length';
  if ('options' in d) return `${d.options.slice(0, -1).join(', ')}${d.options.length > 1 ? ' or ' : ''}${d.options.at(-1)} seconds`;
  return `${d.min} to ${d.max} seconds`;
}

/** The aspect_ratio value to send, or undefined when the endpoint takes none. "auto" maps to auto/adaptive. */
export function aspectValue(spec: EndpointSpec, chosen: string): string | undefined | null {
  if (!spec.aspectRatios) return undefined;
  if (chosen === 'auto') return spec.aspectRatios.includes('auto') ? 'auto' : spec.aspectRatios.includes('adaptive') ? 'adaptive' : null;
  return spec.aspectRatios.includes(chosen) ? chosen : null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The endpoint a prompt goes to, or the reasons it can't be made with these settings.
 * The same check runs in the studio (as prompt warnings) and on the server (as a refusal).
 */
export function resolveEndpoint(selection: Selection, media: MediaCounts, promptText: string): { spec?: EndpointSpec; problems: string[] } {
  const model = modelById(selection.model);
  if (!model) return { problems: ['Choose a video model'] };
  const quality = qualityOf(model, selection.quality);
  if (!quality) return { problems: [`Choose a quality for ${model.name}`] };
  const spec = quality.inputs[media.mode];
  const label = inputLabel(model, media.mode);
  if (!spec) {
    const offered = model.qualities.filter((q) => q.inputs[media.mode]).map((q) => q.label);
    return {
      problems: [
        offered.length > 0
          ? `${model.name} ${quality.label} can't do “${label}”; choose ${offered.join(' or ')}`
          : `${model.name} doesn't support “${label}”; pick another option for this prompt`,
      ],
    };
  }

  const problems: string[] = [];
  const text = promptText.trim();
  if (spec.prompt && !text) problems.push('Write a prompt');
  if (spec.promptMaxChars && text.length > spec.promptMaxChars) problems.push(`${model.name} takes prompts up to ${spec.promptMaxChars.toLocaleString('en-US')} characters`);
  if (spec.duration && !durationFits(spec, selection.duration)) {
    problems.push(`${model.name} “${label}” makes ${describeDuration(spec)}; change the duration`);
  }
  if (spec.aspectRatios && aspectValue(spec, selection.aspectRatio) === null) {
    problems.push(`${model.name} “${label}” supports ${spec.aspectRatios.filter((r) => r !== 'adaptive').join(', ')}; change the aspect ratio`);
  }
  if (spec.start && !media.start) problems.push(media.mode === 'motion' ? 'Add the character image' : 'Add a start frame');
  if (spec.source && !media.source) problems.push(media.mode === 'motion' || media.mode === 'swap' ? 'Add the source video' : 'Add the video');
  const lists: [MediaKind, ListSpec | undefined, number][] = [
    ['image', spec.images, media.images],
    ['video', spec.videos, media.videos],
    ['audio', spec.audios, media.audios],
  ];
  for (const [kind, limits, count] of lists) {
    if (!limits && count > 0) problems.push(`${model.name} “${label}” doesn't take ${kind === 'audio' ? 'audio' : `${kind}s`}; remove ${count === 1 ? 'it' : 'them'}`);
    if (limits && count > limits.max) problems.push(`At most ${plural(limits.max, kind === 'audio' ? 'audio file' : kind)} for ${model.name} “${label}”`);
    if (limits && count < limits.min) problems.push(`Add at least ${plural(limits.min, kind === 'audio' ? 'audio file' : kind)}`);
  }
  if (spec.needs && !spec.needs.some((kind) => (kind === 'image' ? media.images : kind === 'video' ? media.videos : media.audios) > 0)) {
    problems.push(`Add at least one reference ${spec.needs.join(', ').replace(/, (\w+)$/, ' or $1')}`);
  }
  if (spec.maxTotalRefs && media.images + media.videos + media.audios > spec.maxTotalRefs) {
    problems.push(`At most ${spec.maxTotalRefs} references in total for ${model.name}`);
  }
  if (media.soundtrack && !spec.soundtrack) problems.push(`${model.name} doesn't take an audio track here; remove it`);
  if (media.end && !spec.end && spec.start) problems.push(`${model.name} doesn't use an end frame; remove it`);
  return { spec, problems };
}

/** Seconds the customer pays for: new seconds and/or the uploaded video, plus any reference videos. */
export function billedSeconds(spec: EndpointSpec, selection: Pick<Selection, 'duration'>, media: Pick<MediaCounts, 'sourceSeconds' | 'referenceVideoSeconds'>): number {
  const output = spec.duration ? selection.duration : 0;
  const source = Math.ceil(media.sourceSeconds ?? 0);
  const references = media.referenceVideoSeconds.reduce((sum, s) => sum + Math.ceil(s), 0);
  const base = spec.billing === 'output' ? output : spec.billing === 'source' ? source : source + output;
  return base + references;
}
