/**
 * Every file operation goes through these helpers so no request can read or write
 * outside LIBRARY_DIR (no "..", no absolute paths, no symlink escapes).
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { HttpError } from '../http-error.js';

/** Normalize a client-supplied library-relative path to POSIX form without leading/trailing slashes. */
export function normalizeRelPath(rel: string): string {
  if (typeof rel !== 'string' || rel.includes('\0')) throw new HttpError(400, 'Invalid path');
  const posix = rel.replace(/\\/g, '/').trim();
  if (path.posix.isAbsolute(posix) || /^[a-zA-Z]:/.test(posix)) throw new HttpError(400, 'Path must be relative to the library');
  const norm = path.posix.normalize(posix === '' ? '.' : posix);
  if (norm === '..' || norm.startsWith('../')) throw new HttpError(400, 'Path escapes the library');
  return norm === '.' ? '' : norm.replace(/\/+$/, '');
}

/** Resolve a library-relative path to an absolute path inside libraryDir. */
export function resolveLibraryPath(libraryDir: string, rel: string): string {
  const norm = normalizeRelPath(rel);
  const abs = path.resolve(libraryDir, norm);
  const root = path.resolve(libraryDir);
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new HttpError(400, 'Path escapes the library');
  // If the path (or its nearest existing parent) is a symlink pointing outside, refuse.
  assertRealPathInside(root, abs);
  return abs;
}

/** Absolute path -> library-relative POSIX path ("" for the root). */
export function toLibraryRel(libraryDir: string, abs: string): string {
  return path.relative(path.resolve(libraryDir), abs).split(path.sep).join('/');
}

function assertRealPathInside(root: string, abs: string): void {
  let probe = abs;
  // Walk up to the nearest existing ancestor; new files are checked via their parent.
  for (;;) {
    try {
      const real = realpathSync(probe);
      const realRoot = realpathSync(root);
      if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new HttpError(400, 'Path escapes the library');
      return;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const parent = path.dirname(probe);
      if (parent === probe) return;
      probe = parent;
    }
  }
}
