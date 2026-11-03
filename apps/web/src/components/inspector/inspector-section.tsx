import type { ReactNode } from 'react';

/** One inspector block: a quiet label, then content. Sections are separated by space, not lines. */
export function InspectorSection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-4 py-3">
      <div className="mb-2 flex min-h-5 items-center justify-between gap-2">
        <h3 className="text-caption font-semibold text-muted">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Narrow key/value list: label on the left, value wraps on the right. */
export function InspectorFacts({ items }: { items: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-3 gap-y-1.5">
      {items.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export const InspectorNote = ({ children }: { children: ReactNode }) => <p className="px-4 py-3 text-muted">{children}</p>;
