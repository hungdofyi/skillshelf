/** Agent Skills spec limits, shared by the server linter and the UI forms. */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SKILL_NAME_MAX = 64;
export const SKILL_DESCRIPTION_MAX = 1024;
/** Spec recommendation: keep SKILL.md body under this many lines; move detail to references/. */
export const SKILL_BODY_LINES_SOFT_MAX = 500;
/** Names that the spec reserves. */
export const SKILL_RESERVED_WORDS = ['anthropic', 'claude'] as const;

export const BOOK_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** "The Art of War: Sun Tzu" -> "the-art-of-war-sun-tzu" (ASCII, max 64 chars). */
export function slugify(input: string, max = 64): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, max).replace(/-+$/g, '') || 'untitled';
}
