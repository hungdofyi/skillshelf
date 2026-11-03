import { useEffect, useMemo, useState } from 'react';
import { Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import type { EvalCase, EvalFile } from '@b2s/shared';
import { ApiError } from '../../api/client';
import { useFile, useWriteFile } from '../../api/queries';
import { useDirtyGuard } from '../../lib/location-state';
import { Button, IconButton } from '../../components/ui/button';
import { Checkbox, Field, Input, LoadingBlock, SectionTitle, Textarea } from '../../components/ui/misc';

export function parseEvalFile(text: string | undefined, skill: string): { file: EvalFile; error?: string } {
  if (!text) return { file: { skill_name: skill, evals: [] } };
  try {
    const raw = JSON.parse(text) as Partial<EvalFile>;
    return { file: { ...raw, skill_name: raw.skill_name ?? skill, evals: Array.isArray(raw.evals) ? raw.evals : [] } };
  } catch (e) {
    return { file: { skill_name: skill, evals: [] }, error: e instanceof Error ? e.message : 'Invalid JSON' };
  }
}

const nextId = (cases: EvalCase[]): number => cases.reduce((m, c) => Math.max(m, typeof c.id === 'number' ? c.id : Number.parseInt(String(c.id), 10) || 0), 0) + 1;

function CaseForm({ c, index, onChange, onRemove }: { c: EvalCase; index: number; onChange: (c: EvalCase) => void; onRemove: () => void }) {
  const setExp = (i: number, v: string) => onChange({ ...c, expectations: c.expectations.map((e, n) => (n === i ? v : e)) });
  return (
    <details open={index === 0} className="group rounded-lg bg-raised shadow-raised">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-3 py-2">
        <span className="font-mono text-caption text-faint">#{String(c.id)}</span>
        <span className="min-w-0 flex-1 truncate">{c.prompt || <span className="text-faint">Empty prompt</span>}</span>
        {c.should_trigger === false && <span className="text-micro text-muted">near miss</span>}
        <IconButton label="Delete case" onClick={(e) => { e.preventDefault(); onRemove(); }}><Trash2 size={14} /></IconButton>
      </summary>
      <div className="flex flex-col gap-3 border-t border-line p-3">
        <Field label="Prompt" htmlFor={`p-${c.id}`}><Textarea id={`p-${c.id}`} value={c.prompt} rows={3} onChange={(e) => onChange({ ...c, prompt: e.target.value })} /></Field>
        <Field label="Expected output (optional)" htmlFor={`o-${c.id}`}><Textarea id={`o-${c.id}`} value={c.expected_output ?? ''} rows={2} onChange={(e) => onChange({ ...c, expected_output: e.target.value || undefined })} /></Field>
        <Field label="Expectations" hint="Checkable statements the grader marks pass or fail.">
          <div className="flex flex-col gap-1.5">
            {c.expectations.map((x, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input aria-label={`Expectation ${i + 1}`} value={x} onChange={(e) => setExp(i, e.target.value)} />
                <IconButton label="Remove expectation" onClick={() => onChange({ ...c, expectations: c.expectations.filter((_, n) => n !== i) })}><X size={14} /></IconButton>
              </div>
            ))}
            <Button size="sm" variant="ghost" className="self-start" icon={<Plus size={13} />} onClick={() => onChange({ ...c, expectations: [...c.expectations, ''] })}>Add expectation</Button>
          </div>
        </Field>
        <Checkbox checked={c.should_trigger !== false} onChange={(v) => onChange({ ...c, should_trigger: v ? undefined : false })}>The skill should trigger on this prompt</Checkbox>
      </div>
    </details>
  );
}

/** Structured editor for skills/<name>/evals/evals.json. Unknown fields on cases are preserved. */
export function EvalCasesEditor({ skill, skillPath, onDirty }: { skill: string; skillPath: string; onDirty: (dirty: boolean) => void }) {
  const path = `${skillPath}/evals/evals.json`;
  const query = useFile(path);
  const write = useWriteFile();
  const missing = query.error instanceof ApiError && query.error.status === 404;
  const server = useMemo(() => parseEvalFile(query.data?.content, skill), [query.data?.content, skill]);
  const [cases, setCases] = useState<EvalCase[] | null>(null);
  const [base, setBase] = useState<number | undefined>();
  const current = cases ?? server.file.evals;
  const dirty = cases !== null && JSON.stringify(cases) !== JSON.stringify(server.file.evals);
  useDirtyGuard(`evals:${path}`, dirty);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const edit = (next: EvalCase[]) => { if (cases === null) setBase(query.data?.mtimeMs); setCases(next); };
  const save = (force = false) => {
    const body: EvalFile = { ...server.file, skill_name: skill, evals: current.map((c) => ({ ...c, expectations: c.expectations.map((e) => e.trim()).filter(Boolean) })) };
    if (body.evals.some((c) => !c.prompt.trim())) return void toast.error('Every case needs a prompt');
    write.mutate({ path, content: `${JSON.stringify(body, null, 2)}\n`, expectedMtimeMs: force ? undefined : base }, {
      onSuccess: () => { setCases(null); toast.success('Evals saved', { duration: 1500 }); },
      onError: (e) => e instanceof ApiError && e.status === 409
        ? toast.warning('evals.json changed on disk', { action: { label: 'Overwrite', onClick: () => save(true) }, cancel: { label: 'Reload', onClick: () => { setCases(null); void query.refetch(); } } })
        : toast.error('Could not save evals', { description: e instanceof Error ? e.message : String(e) }),
    });
  };

  if (query.isPending) return <LoadingBlock />;
  if (query.error && !missing) return <p className="text-danger">{query.error.message}</p>;
  return (
    <section>
      <SectionTitle aside={
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => edit([...current, { id: nextId(current), prompt: '', expectations: [''] }])}>Add case</Button>
          <Button size="sm" variant="primary" icon={<Save size={13} />} disabled={!dirty} loading={write.isPending} onClick={() => save()}>Save</Button>
        </div>
      }>Eval cases ({current.length})</SectionTitle>
      {server.error && <p className="mb-2 rounded-md bg-warn-soft px-3 py-2 text-warn">evals.json is not valid JSON ({server.error}). Saving here replaces it.</p>}
      {current.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-muted">No eval cases yet. Add a prompt and the statements a good answer must satisfy.</p>
      ) : (
        <div className="flex flex-col gap-2">{current.map((c, i) => <CaseForm key={String(c.id)} c={c} index={i} onChange={(n) => edit(current.map((x, j) => (j === i ? n : x)))} onRemove={() => edit(current.filter((_, j) => j !== i))} />)}</div>
      )}
    </section>
  );
}
