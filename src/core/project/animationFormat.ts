import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { deflate, inflate } from 'node:zlib';
import { AppError } from '../errors';
import { ANIMATION_LIMITS, type AnimationDocument } from '@shared/types/animation';

const deflateAsync = promisify(deflate);
const inflateAsync = promisify(inflate);

/** Manifest of the stored animation, inside `drawings/`. */
export const ANIMATION_MANIFEST_FILE = 'animation.json';

/** Directory (inside `drawings/`) holding the compressed pixel data of layers. */
export const ANIMATION_LAYERS_DIRECTORY = 'layers';

export const ANIMATION_FORMAT_VERSION = 1;

const LAYER_FILE_PATTERN = /^[a-f0-9]{64}\.rgba\.z$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/** Maximum canvas edge/area accepted by the persistence layer (same limits as the editor). */
const MAX_DIMENSION = 16_384;
const MAX_PIXELS = 36_000_000;

export interface StoredLayer {
  id: string;
  name: string;
  visible: boolean;
  /** Name of the file holding the pixels, or `null` for a blank layer. */
  file: string | null;
}

export interface StoredFrame {
  id: string;
  layers: StoredLayer[];
}

export interface AnimationManifest {
  formatVersion: number;
  width: number;
  height: number;
  frames: StoredFrame[];
}

function invalid(message = 'The animation data is not valid.'): AppError {
  return new AppError('INVALID_ANIMATION_DATA', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseDimension(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > MAX_DIMENSION) {
    throw invalid();
  }
  return value;
}

function parseId(value: unknown): string {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw invalid();
  }
  return value;
}

function parseLayerName(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalid();
  }
  const name = value.trim();
  if (name.length < 1 || name.length > ANIMATION_LIMITS.maxLayerNameLength) {
    throw invalid();
  }
  return name;
}

function parseCanvas(width: unknown, height: unknown): { width: number; height: number } {
  const parsedWidth = parseDimension(width);
  const parsedHeight = parseDimension(height);
  if (parsedWidth * parsedHeight > MAX_PIXELS) {
    throw invalid();
  }
  return { width: parsedWidth, height: parsedHeight };
}

function parseList(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > max) {
    throw invalid();
  }
  return value;
}

/**
 * Validates an animation document received from outside the core (IPC).
 * Nothing is trusted: sizes, identifiers, names and pixel buffers are checked.
 */
export function parseAnimationDocument(input: unknown): AnimationDocument {
  if (!isRecord(input)) {
    throw invalid();
  }
  const { width, height } = parseCanvas(input.width, input.height);
  const expectedLength = width * height * 4;
  const usedIds = new Set<string>();
  const claim = (id: string): string => {
    if (usedIds.has(id)) {
      throw invalid();
    }
    usedIds.add(id);
    return id;
  };

  const frames = parseList(input.frames, ANIMATION_LIMITS.maxFrames).map((rawFrame) => {
    if (!isRecord(rawFrame)) {
      throw invalid();
    }
    const id = claim(parseId(rawFrame.id));
    const layers = parseList(rawFrame.layers, ANIMATION_LIMITS.maxLayersPerFrame).map((rawLayer) => {
      if (!isRecord(rawLayer) || typeof rawLayer.visible !== 'boolean') {
        throw invalid();
      }
      const pixels = rawLayer.pixels;
      let bytes: Uint8Array | null = null;
      if (pixels !== null) {
        // `ArrayBuffer.isView` (not `instanceof`) so buffers coming from another JS realm are accepted.
        if (!ArrayBuffer.isView(pixels) || pixels.byteLength !== expectedLength) {
          throw invalid();
        }
        bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      }
      return {
        id: claim(parseId(rawLayer.id)),
        name: parseLayerName(rawLayer.name),
        visible: rawLayer.visible,
        pixels: bytes
      };
    });
    return { id, layers };
  });

  return { width, height, frames };
}

/** Validates the stored manifest read from disk. */
export function parseAnimationManifest(input: unknown): AnimationManifest {
  if (!isRecord(input) || input.formatVersion !== ANIMATION_FORMAT_VERSION) {
    throw invalid('The stored animation uses an unsupported format.');
  }
  const { width, height } = parseCanvas(input.width, input.height);
  const frames = parseList(input.frames, ANIMATION_LIMITS.maxFrames).map((rawFrame): StoredFrame => {
    if (!isRecord(rawFrame)) {
      throw invalid();
    }
    const layers = parseList(rawFrame.layers, ANIMATION_LIMITS.maxLayersPerFrame).map((rawLayer): StoredLayer => {
      if (!isRecord(rawLayer) || typeof rawLayer.visible !== 'boolean') {
        throw invalid();
      }
      const file = rawLayer.file;
      if (file !== null && !(typeof file === 'string' && LAYER_FILE_PATTERN.test(file))) {
        throw invalid();
      }
      return {
        id: parseId(rawLayer.id),
        name: parseLayerName(rawLayer.name),
        visible: rawLayer.visible,
        file: file ?? null
      };
    });
    return { id: parseId(rawFrame.id), layers };
  });
  return { formatVersion: ANIMATION_FORMAT_VERSION, width, height, frames };
}

/** Content-addressed file name: identical layers share one file, changed layers never overwrite old data. */
export function layerFileName(pixels: Uint8Array): string {
  return `${createHash('sha256').update(pixels).digest('hex')}.rgba.z`;
}

export async function compressPixels(pixels: Uint8Array): Promise<Buffer> {
  return deflateAsync(pixels);
}

/** Inflates stored pixels; refuses data that does not decompress to exactly `expectedLength` bytes. */
export async function decompressPixels(data: Uint8Array, expectedLength: number): Promise<Uint8Array> {
  try {
    const result = await inflateAsync(data, { maxOutputLength: expectedLength });
    if (result.length !== expectedLength) {
      throw invalid('A stored drawing is damaged.');
    }
    return new Uint8Array(result.buffer, result.byteOffset, result.length);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('INVALID_ANIMATION_DATA', 'A stored drawing is damaged.', { cause: error });
  }
}
