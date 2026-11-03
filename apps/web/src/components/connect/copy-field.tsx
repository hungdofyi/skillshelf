import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { copyText } from '../../lib/format';
import { OneLine } from '../ui/one-line';

/**
 * Read-only command, URL or prompt with its Copy button inside the same 32px block. The value stays on
 * one line: long values fade at the overflowing edge and scroll sideways, never wrap or show a scrollbar.
 * `display` replaces the visible text (e.g. a URL with its secret masked); Copy always copies `value`.
 */
export function CopyField({ value, label, display }: { value: string; label: string; display?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (await copyText(value)) {
      setDone(true);
      window.setTimeout(() => setDone(false), 1500);
    }
  };
  return (
    <div className="flex h-8 min-w-0 items-center gap-1 rounded-md bg-sunken pl-2.5 pr-1">
      <OneLine label={label} className="flex-1 font-mono text-caption text-fg">{display ?? value}</OneLine>
      <button
        type="button"
        onClick={copy}
        aria-label={done ? `${label} copied` : `Copy ${label.toLowerCase()}`}
        className="fx relative flex h-6 shrink-0 items-center gap-1.5 rounded px-2 text-caption font-medium text-muted before:absolute before:-inset-y-1 before:inset-x-0 hover:bg-hover hover:text-fg"
      >
        {done ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
        {done ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
