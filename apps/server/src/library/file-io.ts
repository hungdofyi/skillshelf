/** Safe file operations on the library folder. Callers pass library-relative paths. */
import { randomBytes } from 'node:crypto';
import { cpSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FileResponse } from '@b2s/shared';
import { HttpError } from '../http-error.js';
import { normalizeRelPath, resolveLibraryPath } from './library-paths.js';

export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
/** Top-level folders that may never be deleted, renamed or overwritten. */
const PROTECTED_ROOTS = new Set(['books', 'skills', 'evals']);

function assertNotProtected(rel: string, verb: string): void {
  if (rel === '' || PROTECTED_ROOTS.has(rel)) throw new HttpError(403, `Refusing to ${verb} "${rel || '/'}"`);
}

/** Returns UTF-8 text when decodable (no NUL, valid UTF-8, <= 5 MB); otherwise binary. */
export function readLibraryFile(libraryDir: string, rel: string): FileResponse {
  const norm = normalizeRelPath(rel);
  const abs = resolveLibraryPath(libraryDir, norm);
  if (!existsSync(abs)) throw new HttpError(404, `File not found: ${norm}`);
  const st = statSync(abs);
  if (!st.isFile()) throw new HttpError(400, `Not a file: ${norm}`);
  const base = { path: norm, size: st.size, mtimeMs: st.mtimeMs };
  if (st.size > MAX_TEXT_BYTES) return { ...base, binary: true };
  const buf = readFileSync(abs);
  if (buf.includes(0)) return { ...base, binary: true };
  try {
    return { ...base, binary: false, content: new TextDecoder('utf-8', { fatal: true }).decode(buf) };
  } catch {
    return { ...base, binary: true };
  }
}

/**
 * Atomic write (tmp + rename). 409 when expectedMtimeMs no longer matches.
 * createOnly: exclusive create ("wx"), so an existing file is never replaced, even by a concurrent writer.
 */
export async function writeLibraryFile(libraryDir: string, rel: string, content: string, expectedMtimeMs?: number,
  createOnly = false): Promise<FileResponse> {
  const norm = normalizeRelPath(rel);
  assertNotProtected(norm, 'write');
  const abs = resolveLibraryPath(libraryDir, norm);
  const existing = await stat(abs).catch(() => undefined);
  if (existing?.isDirectory()) throw new HttpError(400, `Is a directory: ${norm}`);
  if (expectedMtimeMs !== undefined && existing && Math.abs(existing.mtimeMs - expectedMtimeMs) > 1) {
    throw new HttpError(409, 'File changed on disk since it was loaded', { mtimeMs: existing.mtimeMs });
  }
  await mkdir(path.dirname(abs), { recursive: true });
  if (createOnly) {
    try {
      await writeFile(abs, content, { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new HttpError(409, `A file named "${path.basename(norm)}" already exists`);
      throw err;
    }
    const created = await stat(abs);
    return { path: norm, binary: false, content, size: created.size, mtimeMs: created.mtimeMs };
  }
  const tmp = `${abs}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, abs);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  const st = await stat(abs);
  return { path: norm, binary: false, content, size: st.size, mtimeMs: st.mtimeMs };
}

export function renameLibraryPath(libraryDir: string, from: string, to: string): void {
  const f = normalizeRelPath(from);
  const t = normalizeRelPath(to);
  assertNotProtected(f, 'rename');
  assertNotProtected(t, 'overwrite');
  const absFrom = resolveLibraryPath(libraryDir, f);
  const absTo = resolveLibraryPath(libraryDir, t);
  if (!existsSync(absFrom)) throw new HttpError(404, `Not found: ${f}`);
  if (existsSync(absTo)) throw new HttpError(409, `Already exists: ${t}`);
  if (absTo.startsWith(absFrom + path.sep)) throw new HttpError(400, 'Cannot move a folder into itself');
  mkdirSync(path.dirname(absTo), { recursive: true });
  renameSync(absFrom, absTo);
}

/** Moves the entry to <dataDir>/trash/<iso-ts>/<rel> instead of deleting it. */
export function trashLibraryPath(libraryDir: string, dataDir: string, rel: string): string {
  const norm = normalizeRelPath(rel);
  assertNotProtected(norm, 'delete');
  const abs = resolveLibraryPath(libraryDir, norm);
  if (!existsSync(abs)) throw new HttpError(404, `Not found: ${norm}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(dataDir, 'trash', stamp, norm);
  mkdirSync(path.dirname(dest), { recursive: true });
  try {
    renameSync(abs, dest);
  } catch (err) {
    // Library and data dir on different volumes: copy then remove.
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    cpSync(abs, dest, { recursive: true });
    rmSync(abs, { recursive: true, force: true });
  }
  return dest;
}

export function createLibraryFolder(libraryDir: string, rel: string): void {
  const norm = normalizeRelPath(rel);
  if (norm === '') throw new HttpError(400, 'Invalid path');
  mkdirSync(resolveLibraryPath(libraryDir, norm), { recursive: true });
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.zip': 'application/zip',
};

/** Streaming read for the /api/raw preview endpoint. */
export function openRawStream(libraryDir: string, rel: string): { stream: ReadableStream<Uint8Array>; size: number; contentType: string } {
  const norm = normalizeRelPath(rel);
  const abs = resolveLibraryPath(libraryDir, norm);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new HttpError(404, `File not found: ${norm}`);
  const size = statSync(abs).size;
  const contentType = MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  const node = createReadStream(abs);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      node.on('data', (chunk) => controller.enqueue(new Uint8Array(chunk as Buffer)));
      node.on('end', () => controller.close());
      node.on('error', (e) => controller.error(e));
    },
    cancel() {
      node.destroy();
    },
  });
  return { stream, size, contentType };
}
