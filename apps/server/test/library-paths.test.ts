import { mkdirSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { normalizeRelPath, resolveLibraryPath, toLibraryRel } from '../src/library/library-paths.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), 'b2s-paths-'));
  dirs.push(d);
  return d;
};

describe('library paths', () => {
  it('normalizes and rejects traversal / absolute paths', () => {
    expect(normalizeRelPath('a//b/./c/')).toBe('a/b/c');
    expect(normalizeRelPath('')).toBe('');
    expect(() => normalizeRelPath('../x')).toThrow();
    expect(() => normalizeRelPath('a/../../x')).toThrow();
    expect(() => normalizeRelPath('/etc/passwd')).toThrow();
    expect(() => normalizeRelPath('C:\\x')).toThrow();
    expect(() => normalizeRelPath('a\0b')).toThrow();
    expect(() => normalizeRelPath('..\\x')).toThrow();
  });

  it('refuses symlink escapes but allows inner symlinks', () => {
    const lib = tmp();
    const outside = tmp();
    mkdirSync(path.join(lib, 'real'));
    symlinkSync(outside, path.join(lib, 'escape'));
    symlinkSync(path.join(lib, 'real'), path.join(lib, 'inner'));
    expect(() => resolveLibraryPath(lib, 'escape')).toThrow();
    expect(() => resolveLibraryPath(lib, 'escape/new-file.md')).toThrow();
    expect(resolveLibraryPath(lib, 'inner/x.md')).toBe(path.join(lib, 'inner/x.md'));
    expect(toLibraryRel(lib, path.join(lib, 'real/a.md'))).toBe('real/a.md');
  });
});
