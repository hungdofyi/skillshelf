/** Validation + storage for uploaded book files (PDF / EPUB). */
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { slugify } from '@b2s/shared';
import { HttpError } from '../http-error.js';

export const MAX_BOOK_BYTES = 300 * 1024 * 1024;

export type UploadFormat = 'pdf' | 'epub';

/** Extension must be .pdf/.epub AND the leading bytes must match that format. */
export async function detectBookFormat(file: File): Promise<UploadFormat> {
  const ext = path.extname(file.name).toLowerCase();
  if (ext !== '.pdf' && ext !== '.epub') throw new HttpError(400, 'Only .pdf and .epub files are supported');
  if (file.size === 0) throw new HttpError(400, 'File is empty');
  if (file.size > MAX_BOOK_BYTES) throw new HttpError(413, 'File is larger than 300 MB');
  const head = Buffer.from(await file.slice(0, 200).arrayBuffer());
  if (ext === '.pdf') {
    if (!head.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new HttpError(400, 'File is not a valid PDF (bad magic bytes)');
    return 'pdf';
  }
  // EPUB = zip whose first entry is a stored "mimetype" file containing application/epub+zip. The
  // local header has a variable-length extra field (e.g. macOS `zip`), so look for the name followed
  // by the content within the first 200 bytes instead of at a fixed offset.
  const isZip = head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  const mimeOk = /mimetype[\s\S]{0,64}?application\/epub\+zip/.test(head.toString('latin1'));
  if (!isZip || !mimeOk) throw new HttpError(400, 'File is not a valid EPUB (bad mimetype entry)');
  return 'epub';
}

/** First free slug: base, base-2, base-3 … */
export function uniqueSlug(booksDir: string, wanted: string): string {
  const base = slugify(wanted);
  let slug = base;
  for (let n = 2; existsSync(path.join(booksDir, slug)); n++) {
    slug = `${base.slice(0, 60)}-${n}`;
  }
  return slug;
}

export function sanitizeFileName(name: string, format: UploadFormat): string {
  const stem = path.basename(name, path.extname(name)).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'book';
  return `${stem.slice(0, 120)}.${format}`;
}

/** Stream the upload to books/<slug>/source/<name>; removes the book folder on failure. */
export async function storeSource(bookDir: string, fileName: string, file: File): Promise<void> {
  const sourceDir = path.join(bookDir, 'source');
  mkdirSync(sourceDir, { recursive: true });
  try {
    await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(path.join(sourceDir, fileName)));
  } catch (err) {
    rmSync(bookDir, { recursive: true, force: true });
    throw err;
  }
}
