import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { ListTree } from 'lucide-react';
import { DropdownMenu } from '../ui/menu';
import { IconButton } from '../ui/button';

interface Heading { id: string; text: string; level: 2 | 3 }

/** h2/h3 headings rendered inside `container`, plus the one currently at the top of the viewport. */
function useOutline(container: HTMLElement | null, version: string) {
  const [items, setItems] = useState<Heading[]>([]);
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    if (!container) {
      setItems([]);
      return;
    }
    const raf = requestAnimationFrame(() => {
      const hs = Array.from(container.querySelectorAll<HTMLHeadingElement>('.prose-b2s h2[id], .prose-b2s h3[id]'));
      setItems(hs.map((h) => ({ id: h.id, text: (h.textContent ?? '').replace(/^#/, ''), level: h.tagName === 'H2' ? 2 : 3 })));
    });
    return () => cancelAnimationFrame(raf);
  }, [container, version]);

  useEffect(() => {
    if (!container || !items.length) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = container.getBoundingClientRect().top + 48;
        let current: string | null = items[0]?.id ?? null;
        for (const it of items) {
          const h = document.getElementById(it.id);
          if (h && h.getBoundingClientRect().top <= top) current = it.id;
        }
        setActive(current);
      });
    };
    onScroll();
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [container, items]);

  return { items, active };
}

const jumpTo = (id: string) => document.getElementById(id)?.scrollIntoView({ block: 'start' });

/**
 * "On this page" for a scrolling Markdown pane. It floats over the pane's right edge and never takes
 * layout space, so the text column stays centred. Where the pane is too narrow to float a list beside
 * the text, it collapses to a button that opens the same headings as a menu.
 */
export function OutlineOverlay({ container, version }: { container: HTMLElement | null; version: string }) {
  const { items, active } = useOutline(container, version);
  if (items.length < 2) return null;
  return (
    <>
      <nav aria-label="On this page" className="absolute right-6 top-8 hidden max-h-[calc(100%-4rem)] w-52 overflow-y-auto @min-[1120px]:block">
        <p className="mb-1.5 px-2 text-caption font-semibold text-muted">On this page</p>
        <ul className="flex flex-col">
          {items.map((it) => (
            <li key={it.id}>
              <a
                href={`#${it.id}`}
                title={it.text}
                aria-current={active === it.id ? 'location' : undefined}
                onClick={(e) => { e.preventDefault(); jumpTo(it.id); }}
                className={clsx(
                  'block truncate rounded py-1 pr-2 text-caption leading-snug',
                  it.level === 3 ? 'pl-5' : 'pl-2',
                  active === it.id ? 'bg-hover text-fg' : 'text-muted hover:text-fg',
                )}
              >
                {it.text}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="absolute right-3 top-3 @min-[1120px]:hidden">
        <DropdownMenu
          align="end"
          items={items.map((it) => ({ label: it.text, inset: it.level === 3, checked: active === it.id, onSelect: () => jumpTo(it.id) }))}
          trigger={<IconButton label="On this page" className="bg-surface"><ListTree size={16} /></IconButton>}
        />
      </div>
    </>
  );
}
