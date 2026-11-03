/** Small pure helpers shared by the MCP server and its search index. */

/** Default page size for read tools. Claude Code caps tool output near 25k tokens (~40k chars is safe). */
export const DEFAULT_MAX_CHARS = 40_000;
export const HARD_MAX_CHARS = 100_000;
/** Target size of one search/fetch chunk of a long document. */
export const CHUNK_CHARS = 4_000;

export interface TextPage {
  text: string;
  offset: number;
  total_chars: number;
  /** Present only when more text remains. */
  next_offset?: number;
}

/** Slice [offset, offset+max) of text, reporting where to continue. */
export function pageText(text: string, offset = 0, maxChars = DEFAULT_MAX_CHARS): TextPage {
  const start = Math.min(Math.max(0, Math.floor(offset)), text.length);
  const size = Math.min(Math.max(1, Math.floor(maxChars)), HARD_MAX_CHARS);
  const end = Math.min(text.length, start + size);
  const page: TextPage = { text: text.slice(start, end), offset: start, total_chars: text.length };
  if (end < text.length) page.next_offset = end;
  return page;
}

/** Split on paragraph boundaries into ~size-char chunks; deterministic so ids stay stable. */
export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const para of text.split(/\n{2,}/)) {
    if (current && current.length + para.length + 2 > size) {
      chunks.push(current);
      current = '';
    }
    if (para.length > size) {
      // A single huge paragraph: hard-split.
      for (let i = 0; i < para.length; i += size) chunks.push(para.slice(i, i + size));
      continue;
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Id suffix: single-chunk docs have no suffix; multi-chunk docs get #1..#n. */
export function chunkSuffix(n: number, total: number): string {
  return total > 1 ? `#${n}` : '';
}
