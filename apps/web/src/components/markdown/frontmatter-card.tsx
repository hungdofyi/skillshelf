import { AlertTriangle } from 'lucide-react';

function renderValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined) return <span className="text-faint">empty</span>;
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ');
  if (typeof v === 'object') {
    return (
      <div className="flex flex-col gap-0.5">
        {Object.entries(v as Record<string, unknown>).map(([k, x]) => (
          <div key={k} className="min-w-0">
            <span className="font-mono text-caption text-muted">{k}</span> <span>{typeof x === 'object' ? JSON.stringify(x) : String(x)}</span>
          </div>
        ))}
      </div>
    );
  }
  return String(v);
}

/** Frontmatter keys and values. `stacked` puts each value under its key, for narrow columns like the inspector. */
export function FrontmatterList({ data, error, stacked }: { data: Record<string, unknown> | null; error?: string; stacked?: boolean }) {
  return (
    <>
      {error && (
        <p className="mb-1 flex items-center gap-1.5 text-warn">
          <AlertTriangle size={13} aria-hidden /> Frontmatter could not be parsed: {error}
        </p>
      )}
      {data && (
        <dl className={stacked ? 'flex flex-col gap-2' : 'grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1'}>
          {Object.entries(data).map(([k, v]) => (
            <div key={k} className={stacked ? 'min-w-0' : 'contents'}>
              <dt className="font-mono text-caption text-muted">{k}</dt>
              <dd className="min-w-0 break-words">{renderValue(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  );
}

/** Frontmatter above a rendered body: one tinted block, no border (one depth cue per surface). */
export function FrontmatterCard({ data, error }: { data: Record<string, unknown> | null; error?: string }) {
  if (!data && !error) return null;
  return (
    // Full column width: the article sets the measure, so the card lines up with the prose below it.
    <section aria-label="Frontmatter" className="mb-6 w-full rounded-lg bg-hover px-3.5 py-2.5 font-sans text-ui leading-snug">
      <FrontmatterList data={data} error={error} />
    </section>
  );
}
