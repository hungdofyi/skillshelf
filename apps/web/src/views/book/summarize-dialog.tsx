import { useMemo, useState } from 'react';
import { BookText } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { Effort, Job, SummarizeBookRequest, SummaryLength, SummaryStructure } from '@b2s/shared';
import { keys, upsertJob, useBook, useClaudeStatus, useSummarizeBook } from '../../api/queries';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { Checkbox, Field, LoadingBlock, Segmented, Select, Textarea } from '../../components/ui/misc';
import { ClaudeStatusNote } from '../../components/skill/claude-status-note';
import { EFFORT_DEFAULTS, EffortSelect } from '../../components/skill/effort-select';
import { isBoilerplateChapter } from '../../lib/chapter-boilerplate';
import { openJob } from '../../lib/ui-store';
import { shortcutLabels } from '../../lib/use-global-shortcuts';

const FOCUS_MAX = 500;

const LENGTHS: Array<{ value: SummaryLength; label: string; hint: string }> = [
  { value: 'brief', label: 'Brief', hint: '2 to 3 sentences per chapter.' },
  { value: 'standard', label: 'Standard', hint: 'A short paragraph and 3 to 5 key ideas per chapter.' },
  { value: 'detailed', label: 'Detailed', hint: 'Several paragraphs, key ideas and examples per chapter.' },
];
const STRUCTURES: Array<{ value: SummaryStructure; label: string; hint: string }> = [
  { value: 'both', label: 'Both', hint: 'Key ideas across the book, then a chapter-by-chapter guide.' },
  { value: 'chapters', label: 'By chapter', hint: 'A chapter-by-chapter guide.' },
  { value: 'ideas', label: 'Key ideas', hint: 'Key ideas across the book, each citing its chapters.' },
];

/** Summarize dialog: how long, how structured, for whom, which chapters. Every chapter in the result links to its file. */
export function SummarizeDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data: book } = useBook(slug);
  const claude = useClaudeStatus();
  const summarize = useSummarizeBook(slug);
  const [length, setLength] = useState<SummaryLength>('standard');
  const [structure, setStructure] = useState<SummaryStructure>('both');
  const [focus, setFocus] = useState('');
  const [model, setModel] = useState('sonnet');
  const [effort, setEffort] = useState<Effort>(EFFORT_DEFAULTS.summarize);
  // undefined until the user touches the picker: the default is every chapter except front/back matter.
  const [picked, setPicked] = useState<number[] | undefined>(undefined);

  const chapters = useMemo(() => book?.manifest?.chapters ?? [], [book]);
  const selected = useMemo(() => picked ?? chapters.filter((c) => !isBoilerplateChapter(c.title)).map((c) => c.index), [picked, chapters]);
  const toggle = (index: number, on: boolean) => setPicked(on ? [...selected, index].sort((a, b) => a - b) : selected.filter((i) => i !== index));

  const ready = claude.data?.ready === true;
  const blocked = !ready ? 'Claude is not ready.' : selected.length === 0 ? 'Pick at least one chapter.' : focus.length > FOCUS_MAX ? `Keep the focus under ${FOCUS_MAX} characters.` : null;

  const submit = () => {
    if (blocked || summarize.isPending) return;
    const req: SummarizeBookRequest = {
      length, structure, model, effort,
      ...(focus.trim() ? { focus: focus.trim() } : {}),
      ...(selected.length < chapters.length ? { chapters: selected } : {}),
    };
    summarize.mutate(req, {
      onSuccess: ({ job }) => {
        qc.setQueryData<Job[]>(keys.jobs, (l) => upsertJob(l, job));
        onClose();
        openJob(job.id);
      },
    });
  };
  const shortcut = (e: React.KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); submit(); } };

  const title = book?.manifest?.title ?? slug;
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Summarize book"
      description={<>Claude reads {title} and writes a guide you can skim. Every chapter in it links to the chapter itself.</>}
      width="lg"
      footer={
        <>
          {blocked && <span className="mr-auto self-center text-caption text-faint">{blocked}</span>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={<BookText size={14} />} disabled={!!blocked} loading={summarize.isPending} onClick={submit} title={blocked ?? `Summarize (${shortcutLabels.mod}Enter)`}>Summarize</Button>
        </>
      }
    >
      {!book ? <LoadingBlock /> : (
        <div className="flex flex-col gap-4">
          <ClaudeStatusNote status={claude.data} loading={claude.isPending} />
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <Field label="Length" hint={LENGTHS.find((l) => l.value === length)!.hint}>
              <Segmented label="Length" value={length} onChange={setLength} options={LENGTHS} />
            </Field>
            <Field label="Structure" hint={STRUCTURES.find((s) => s.value === structure)!.hint}>
              <Segmented label="Structure" value={structure} onChange={setStructure} options={STRUCTURES} />
            </Field>
          </div>
          <Field
            label="Focus (optional)"
            htmlFor="summary-focus"
            error={focus.length > FOCUS_MAX ? `${focus.length} / ${FOCUS_MAX} characters` : null}
            hint="Rates each chapter's relevance to your focus and adds a reading path."
          >
            <Textarea id="summary-focus" autoFocus={!('ontouchstart' in window)} rows={2} value={focus} onKeyDown={shortcut} onChange={(e) => setFocus(e.target.value)} placeholder="I'm a PM improving onboarding" />
          </Field>
          <Field label="Chapters">
            <details className="rounded-md bg-hover px-3 py-2">
              <summary className="cursor-pointer select-none text-caption text-muted">
                <span className="tnum text-fg">{selected.length} of {chapters.length} chapters</span>
                {picked === undefined && chapters.some((c) => isBoilerplateChapter(c.title)) ? ' (front and back matter skipped)' : ''}
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPicked(chapters.map((c) => c.index))}>All</Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked(chapters.filter((c) => !isBoilerplateChapter(c.title)).map((c) => c.index))}>Skip front and back matter</Button>
                <Button size="sm" variant="ghost" onClick={() => setPicked([])}>None</Button>
              </div>
              <div className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto pl-1">
                {chapters.map((c) => (
                  <Checkbox key={c.index} checked={selected.includes(c.index)} onChange={(v) => toggle(c.index, v)}>
                    <span className="truncate">{c.title}</span>
                  </Checkbox>
                ))}
              </div>
            </details>
          </Field>
          <div className="flex flex-wrap items-start gap-6">
            <Field label="Model" htmlFor="summary-model">
              <Select id="summary-model" value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="sonnet">Sonnet</option><option value="opus">Opus</option><option value="haiku">Haiku</option>
              </Select>
            </Field>
            <EffortSelect id="summary-effort" value={effort} onChange={setEffort} />
          </div>
        </div>
      )}
    </Dialog>
  );
}
