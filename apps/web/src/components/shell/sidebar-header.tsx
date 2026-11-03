import type { ReactNode } from 'react';

/** Sidebar header row: the panel title, then its filter field or primary action. Same 40px height as the tab bar. */
export function SidebarHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex h-10 shrink-0 items-center gap-1 pl-3 pr-1.5">
      <h2 className="min-w-0 flex-1 truncate text-ui font-semibold">{title}</h2>
      {children}
    </div>
  );
}

/** Filter field that sits under a sidebar header. */
export function SidebarFilter({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  return (
    <div className="shrink-0 px-2 pb-2">
      <input
        type="search"
        aria-label={label}
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape' && value) { e.stopPropagation(); onChange(''); } }}
        className="fx h-7 w-full rounded-md bg-hover px-2.5 text-ui text-fg placeholder:text-faint focus-visible:bg-surface"
      />
    </div>
  );
}
