import { EFFORTS, type Effort } from '@b2s/shared';
import { Field, Select } from '../ui/misc';

/** Default effort per kind of Claude job; the server applies the same defaults when the field is omitted. */
export const EFFORT_DEFAULTS = { generate: 'high', revise: 'high', eval: 'medium', summarize: 'medium' } as const satisfies Record<string, Effort>;

const INFO: Record<Effort, { label: string; hint: string }> = {
  low: { label: 'Low', hint: 'Faster, lighter on your usage limits.' },
  medium: { label: 'Medium', hint: 'Balanced speed and depth.' },
  high: { label: 'High', hint: 'Careful reasoning; slower and heavier than Medium.' },
  xhigh: { label: 'Extra high', hint: 'Deeper reasoning; noticeably slower, uses more quota.' },
  max: { label: 'Max', hint: 'Slowest, deepest reasoning, most quota.' },
};

export const effortLabel = (e: Effort | string): string => (e in INFO ? INFO[e as Effort].label : e);

/** "Effort" field with a one-line hint for the selected level. */
export function EffortSelect({ id, value, onChange }: { id: string; value: Effort; onChange: (v: Effort) => void }) {
  return (
    <Field label="Effort" htmlFor={id} hint={INFO[value].hint}>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value as Effort)}>
        {EFFORTS.map((e) => <option key={e} value={e}>{INFO[e].label}</option>)}
      </Select>
    </Field>
  );
}
