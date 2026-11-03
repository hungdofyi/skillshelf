import { memo, useMemo, type ComponentPropsWithoutRef } from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import rehypeHighlight from 'rehype-highlight';
import { navigate } from '../../lib/location-state';
import { dirname } from '../../lib/route';
import { rawUrl } from '../../api/client';

/** Resolve a relative link against the current file's folder; returns null when it escapes the library. */
export function resolveRelative(fromFile: string, href: string): string | null {
  const out = dirname(fromFile).split('/').filter(Boolean);
  for (const part of decodeURI(href).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!out.length) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join('/');
}

// The converter writes decorative chapter labels as a paragraph that is exactly "—— CHAPTER 9 ——".
const CHAPTER_LABEL = /^——\s+(.{1,40}?)\s+——$/;

type HastNode = { type: string; value?: string; children?: HastNode[] };
const plainText = (n: HastNode | undefined): string => (n?.type === 'text' ? n.value ?? '' : (n?.children ?? []).map(plainText).join(''));

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ block: 'start' });
}

function buildComponents(filePath: string): Components {
  const Heading = (Tag: 'h2' | 'h3') =>
    function H({ children, id, node: _node, ...rest }: ComponentPropsWithoutRef<'h2'> & { node?: unknown }) {
      return (
        <Tag id={id} {...rest}>
          {id && (
            <a className="anchor" href={`#${id}`} aria-label="Link to section" onClick={(e) => { e.preventDefault(); scrollToId(id); }}>
              #
            </a>
          )}
          {children}
        </Tag>
      );
    };
  return {
    p({ children, node, ...rest }) {
      const label = CHAPTER_LABEL.exec(plainText(node as HastNode | undefined).trim())?.[1];
      // A labelled rule, not a paragraph: screen readers hear "separator, Chapter 9".
      if (label) return <div role="separator" aria-label={label} className="chapter-label"><span>{label}</span></div>;
      return <p {...rest}>{children}</p>;
    },
    h2: Heading('h2'),
    h3: Heading('h3'),
    a({ href, children, node: _n, ...rest }) {
      if (!href) return <a {...rest}>{children}</a>;
      if (href.startsWith('#')) {
        return <a href={href} {...rest} onClick={(e) => { e.preventDefault(); scrollToId(decodeURIComponent(href.slice(1))); }}>{children}</a>;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
        return <a href={href} target="_blank" rel="noreferrer noopener" {...rest}>{children}</a>;
      }
      const [pathPart] = href.split('#');
      const target = pathPart ? resolveRelative(filePath, pathPart) : null;
      if (!target) return <a {...rest}>{children}</a>;
      return <a href={`/?path=${encodeURIComponent(target)}`} {...rest} onClick={(e) => { e.preventDefault(); navigate(target); }}>{children}</a>;
    },
    img({ src, alt, node: _n, ...rest }) {
      const resolved = typeof src === 'string' && !/^[a-z][a-z0-9+.-]*:/i.test(src) ? resolveRelative(filePath, src) : null;
      return <img src={resolved ? rawUrl(resolved) : src} alt={alt ?? ''} loading="lazy" {...rest} />;
    },
  };
}

/** Rendered Markdown body (frontmatter must already be stripped). */
export const MarkdownBody = memo(function MarkdownBody({ source, filePath }: { source: string; filePath: string }) {
  const components = useMemo(() => buildComponents(filePath), [filePath]);
  return (
    <div className="prose-b2s">
      <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug, [rehypeHighlight, { detect: false, ignoreMissing: true }]]} components={components}>
        {source}
      </Markdown>
    </div>
  );
});

