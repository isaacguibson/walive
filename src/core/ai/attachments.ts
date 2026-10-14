import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AttachmentPayload, AttachmentPickResult } from '@shared/ai/types';

const MAX_FILES = 8;
const MAX_TEXT_BYTES = 200_000;

const IMAGE_TYPES: Record<string, { mediaType: string; matches(head: Buffer): boolean }> = {
  '.png': { mediaType: 'image/png', matches: (head) => head.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  '.jpg': { mediaType: 'image/jpeg', matches: (head) => head[0] === 0xff && head[1] === 0xd8 },
  '.jpeg': { mediaType: 'image/jpeg', matches: (head) => head[0] === 0xff && head[1] === 0xd8 },
  '.gif': { mediaType: 'image/gif', matches: (head) => head.subarray(0, 3).toString('latin1') === 'GIF' },
  '.webp': { mediaType: 'image/webp', matches: (head) => head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP' }
};

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.csv', '.tsv', '.xml', '.yaml', '.yml', '.toml', '.ini', '.log',
  '.html', '.css', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java', '.c', '.h', '.cpp', '.cs', '.sh', '.sql', '.svg'
]);

type Loaded = { attachment: AttachmentPayload } | { reason: string };

async function load(file: string, maxBytes: number): Promise<Loaded> {
  const extension = path.extname(file).toLowerCase();
  const image = IMAGE_TYPES[extension];
  const isText = TEXT_EXTENSIONS.has(extension);
  if (extension === '.pdf') {
    return { reason: 'PDF text extraction is not available yet. Attach the pages as images or paste the text.' };
  }
  if (image === undefined && !isText) {
    return { reason: 'This file type is not supported.' };
  }
  const stat = await fs.stat(file).catch(() => null);
  if (stat === null || !stat.isFile()) {
    return { reason: 'The file does not exist or is not a regular file.' };
  }
  const limit = image === undefined ? Math.min(maxBytes, MAX_TEXT_BYTES) : maxBytes;
  if (stat.size > limit) {
    return { reason: `The file is larger than the limit of ${Math.floor(limit / 1024)} KB.` };
  }
  const content = await fs.readFile(file).catch(() => null);
  if (content === null) {
    return { reason: 'The file could not be read.' };
  }
  const base = { id: randomUUID(), name: path.basename(file), size: content.length };
  if (image !== undefined) {
    return image.matches(content)
      ? { attachment: { ...base, kind: 'image', mediaType: image.mediaType, data: content.toString('base64') } }
      : { reason: 'The content does not match the file extension.' };
  }
  if (content.includes(0)) {
    return { reason: 'The file is not plain text.' };
  }
  return { attachment: { ...base, kind: 'text', mediaType: 'text/plain', data: content.toString('utf8') } };
}

/** Validates and reads files the user picked. Only the picked paths are ever read. */
export async function readAttachments(files: string[], maxBytes: number): Promise<AttachmentPickResult> {
  const result: AttachmentPickResult = { attachments: [], rejected: [] };
  for (const file of files) {
    const name = path.basename(file);
    if (result.attachments.length >= MAX_FILES) {
      result.rejected.push({ name, reason: `At most ${MAX_FILES} files can be attached to a message.` });
      continue;
    }
    const loaded = await load(file, maxBytes);
    if ('attachment' in loaded) {
      result.attachments.push(loaded.attachment);
    } else {
      result.rejected.push({ name, reason: loaded.reason });
    }
  }
  return result;
}
