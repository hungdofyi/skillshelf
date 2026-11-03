import { useEffect, useMemo, useState } from 'react';
import { Wand2 } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { SKILL_NAME_MAX, SKILL_NAME_PATTERN, SKILL_RESERVED_WORDS, slugify, type BookSummary, type GenerateSkillRequest, type Job } from '@b2s/shared';
import { keys, upsertJob, useBooks, useClaudeStatus, useGenerateSkill, useSkills } from '../../api/queries';
import { Dialog } from '../ui/dialog';
import { Button } from '../ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '../ui/misc';
import { ClaudeStatusNote } from './claude-status-note';
import { openJob, setUi } from '../../lib/ui-store';
import { shortcutLabels } from '../../lib/use-global-shortcuts';

export function validateSkillName(name: string, existing: string[]): string | null {
  if (!name) return 'Enter a name.';
  if (name.length > SKILL_NAME_MAX) return `At most ${SKILL_NAME_MAX} characters.`;
  if (!SKILL_NAME_PATTERN.test(name)) return 'Use lowercase letters, numbers and single hyphens, e.g. onboarding-audit.';
  if (SKILL_RESERVED_WORDS.some((w) => name.includes(w))) return `Names cannot contain "${SKILL_RESERVED_WORDS.join('" or "')}".`;
  if (existing.includes(name)) return 'A skill with this name already exists.';
  return null;
}

function ChapterScope({ book, selected, onChange }: { book: BookSummary; selected: number[] | undefined; onChange: (v: number[] | undefined) => void }) {
  const chapters = book.manifest?.chapters ?? [];
  const all = selected === undefined;
  return (
    <details className="rounded-md bg-hover px-3 py-2">
      <summary className="cursor-pointer select-none text-caption text-muted">
        {book.manifest?.title ?? book.slug}: <span className="text-fg">{all ? 'all chapters' : `${selected.length} of ${chapters.length} chapters`}</span>
      </summary>
      <div className="mt-2 flex flex-col gap-1">
        <Checkbox checked={all} onChange={(v) => onChange(v ? undefined : chapters.map((c) => c.index))}>All chapters</Checkbox>
        <div className="max-h-40 overflow-y-auto pl-1">
          {chapters.map((c) => (
            <Checkbox key={c.index} checked={all || selected.includes(c.index)} disabled={all} onChange={(v) => onChange(v ? [...(selected ?? []), c.index].sort((a, b) => a - b) : (selected ?? []).filter((i) => i !== c.index))}>
              <span className="truncate">{c.title}</span>
            </Checkbox>
          ))}
        </div>
      </div>
    </details>
  );
}

export function CreateSkillDialog({ preselect, onClose }: { preselect: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: books } = useBooks();
  const { data: skills } = useSkills();
  const claude = useClaudeStatus();
  const generate = useGenerateSkill();
  const [goal, setGoal] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [selected, setSelected] = useState<string[]>(preselect ? [preselect] : []);
  const [chapters, setChapters] = useState<Record<string, number[] | undefined>>({});
  const [notes, setNotes] = useState('');
  const [model, setModel] = useState('sonnet');
  const [withEvals, setWithEvals] = useState(true);

  useEffect(() => { if (!nameEdited) setName(goal.trim() ? slugify(goal, 48) : ''); }, [goal, nameEdited]);

  const converted = useMemo(() => (books ?? []).filter((b) => b.status === 'converted' && b.manifest), [books]);
  const nameError = name ? validateSkillName(name, (skills ?? []).map((s) => s.name)) : null;
  const ready = claude.data?.ready === true;
  const canSubmit = ready && goal.trim().length > 0 && !validateSkillName(name, (skills ?? []).map((s) => s.name)) && selected.length > 0;

  // Cmd/Ctrl+Enter from a textarea starts generation; plain Enter keeps inserting newlines.
  const submitShortcut = (e: React.KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit && !generate.isPending) { e.preventDefault(); submit(); } };
  const submit = () => {
    const scoped = Object.fromEntries(selected.flatMap((s) => (chapters[s] ? [[s, chapters[s]!]] : [])));
    const req: GenerateSkillRequest = { books: selected, goal: goal.trim(), name, model, withEvals, ...(notes.trim() ? { notes: notes.trim() } : {}), ...(Object.keys(scoped).length ? { chapters: scoped } : {}) };
    generate.mutate(req, {
      onSuccess: ({ job }) => {
        qc.setQueryData<Job[]>(keys.jobs, (l) => upsertJob(l, job));
        setUi({ createSkillFor: false });
        openJob(job.id);
      },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Create skill"
      description="Claude reads the chapters you choose and writes a skill that applies them to your goal."
      width="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" icon={<Wand2 size={14} />} disabled={!canSubmit} loading={generate.isPending} onClick={submit} title={`Generate skill (${shortcutLabels.mod}Enter)`}>Generate skill</Button></>}
    >
      <div className="flex flex-col gap-4">
        <ClaudeStatusNote status={claude.data} loading={claude.isPending} />
        <Field label="Goal" htmlFor="skill-goal" hint="What should Claude be able to do with this book?">
           <Textarea id="skill-goal" autoFocus={!('ontouchstart' in window)} value={goal} onKeyDown={submitShortcut} onChange={(e) => setGoal(e.target.value)} placeholder="Audit the onboarding flow of a SaaS app" rows={2} />
        </Field>
        <Field label="Skill name" htmlFor="skill-name" error={nameError} hint="Lowercase, hyphenated. Filled from the goal until you edit it.">
          <Input id="skill-name" value={name} className="font-mono" spellCheck={false} onChange={(e) => { setNameEdited(true); setName(e.target.value); }} />
        </Field>
        <Field label="Source books" error={selected.length === 0 ? 'Pick at least one converted book.' : null}>
          {converted.length === 0 ? <p className="text-muted">No converted books yet. Import a PDF or EPUB first.</p> : (
            <div className="flex flex-col gap-1.5">
              {converted.map((b) => (
                <Checkbox key={b.slug} checked={selected.includes(b.slug)} onChange={(v) => setSelected((s) => (v ? [...s, b.slug] : s.filter((x) => x !== b.slug)))}>
                  {b.manifest?.title ?? b.slug} <span className="text-faint">· {b.manifest?.chapters.length} chapters</span>
                </Checkbox>
              ))}
            </div>
          )}
        </Field>
        {selected.length > 0 && (
          <Field label="Chapter scope (optional)">
            <div className="flex flex-col gap-1.5">
              {converted.filter((b) => selected.includes(b.slug)).map((b) => (
                <ChapterScope key={b.slug} book={b} selected={chapters[b.slug]} onChange={(v) => setChapters((c) => ({ ...c, [b.slug]: v }))} />
              ))}
            </div>
          </Field>
        )}
        <Field label="Notes (optional)" htmlFor="skill-notes" hint="Audience, output format, tone.">
          <Textarea id="skill-notes" value={notes} onKeyDown={submitShortcut} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </Field>
        <div className="flex flex-wrap items-end gap-6">
          <Field label="Model" htmlFor="skill-model">
            <Select id="skill-model" value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option>
            </Select>
          </Field>
          <div className="pb-1.5"><Checkbox checked={withEvals} onChange={setWithEvals}>Generate evals</Checkbox></div>
        </div>
      </div>
    </Dialog>
  );
}
