/** Link hygiene for generated book summaries: relative .md links must resolve to real chapter files. */
import path from 'node:path';

const LINK = /(?<!!)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;
const EXTERNAL = /^[a-z][a-z0-9+.-]*:/i;

export interface LinkCheck {
  body: string;
  /** Targets that were turned into plain text. */
  broken: string[];
  /** Number of relative .md links that resolved. */
  valid: number;
}

/**
 * Walk the Markdown body (skipping fenced code) and replace every relative `.md` link whose target
 * is not in `validTargets` with its plain label. Targets are resolved against `fromDir` (library-relative,
 * POSIX); anchors are ignored for the check and kept on valid links. External, anchor-only and
 * non-Markdown links are left alone.
 */
export function stripBrokenChapterLinks(body: string, fromDir: string, validTargets: ReadonlySet<string>): LinkCheck {
  const broken: string[] = [];
  let valid = 0;
  let inFence = false;
  const lines = body.split('\n').map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line.replace(LINK, (whole, label: string, href: string) => {
      if (href.startsWith('#') || EXTERNAL.test(href) || href.startsWith('/')) return whole;
      const [pathPart = ''] = href.split('#');
      if (!pathPart.toLowerCase().endsWith('.md')) return whole;
      let decoded = pathPart;
      try {
        decoded = decodeURI(pathPart);
      } catch {
        // keep as written
      }
      const resolved = path.posix.normalize(path.posix.join(fromDir, decoded));
      if (validTargets.has(resolved)) {
        valid += 1;
        return whole;
      }
      broken.push(href);
      return label;
    });
  });
  return { body: lines.join('\n'), broken, valid };
}
