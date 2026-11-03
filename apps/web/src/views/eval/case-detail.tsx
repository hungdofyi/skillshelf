import { useState } from 'react';
import { Check, Minus, X } from 'lucide-react';
import clsx from 'clsx';
import type { EvalArm, EvalCaseArmResult, ExpectationResult } from '@b2s/shared';
import { useFile } from '../../api/queries';
import { MarkdownBody } from '../../components/markdown/markdown-body';
import { formatDuration } from '../../lib/format';
import { Pill, Segmented } from '../../components/ui/misc';
import { ResultPill, ARM_LABEL } from './eval-bits';

function Answer({ path }: { path: string }) {
  const { data, isPending, error } = useFile(path);
  if (isPending) return <p className="text-muted">Loading answer…</p>;
  if (error || data?.content === undefined) return <p className="text-muted">Answer file not available.</p>;
  return <div className="max-h-[32rem] overflow-auto rounded-md border border-line bg-surface p-4"><div className="prose-compact"><MarkdownBody source={data.content} filePath={path} /></div></div>;
}

/** Arm name, outcome, trigger, time and the judge's one-line summary, at the top of the arm's column. */
function ArmHeader({ arm, result }: { arm: EvalArm; result?: EvalCaseArmResult }) {
  const meta = result && [result.durationMs !== undefined && formatDuration(result.durationMs), result.numTurns !== undefined && `${result.numTurns} turn${result.numTurns === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{ARM_LABEL[arm]}</h4>
        <ResultPill result={result} runActive={false} />
        {arm === 'with_skill' && result?.triggered !== undefined && <Pill tone={result.triggered ? 'ok' : 'warn'}>{result.triggered ? 'Skill used' : 'Skill not used'}</Pill>}
        {meta && <span className="tnum text-caption text-muted">{meta}</span>}
      </div>
      {result?.error && <p className="mt-1.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-danger">{result.error}</p>}
      {result?.judgeSummary && <p className="mt-1.5 text-muted">{result.judgeSummary}</p>}
    </div>
  );
}

/** One arm's verdict on one check: the mark, then the judge's evidence quote. */
function Verdict({ e, label }: { e?: ExpectationResult; label?: string }) {
  // Below sm the columns stack, so each verdict names its arm.
  const name = label && <span className="font-medium not-italic text-fg sm:hidden">{label}: </span>;
  if (!e) return <div className="flex items-start gap-2 text-caption text-faint"><Minus size={14} className="mt-0.5 shrink-0" aria-label="Not graded" /><span>{name}Not graded</span></div>;
  return (
    <div className="flex min-w-0 items-start gap-2">
      {e.passed ? <Check size={14} className="mt-0.5 shrink-0 text-ok" aria-label="Passed" /> : <X size={14} className="mt-0.5 shrink-0 text-danger" aria-label="Missed" />}
      <span className={clsx('min-w-0 text-caption italic', e.evidence ? 'text-muted' : 'text-faint')}>{name}{e.evidence || (e.passed ? 'Passed' : 'Missed')}</span>
    </div>
  );
}

/**
 * An opened case. Both arms are graded on the same checks in the same order, so each check is one row:
 * its text at full width, then the two arms' verdicts side by side in the same columns as the arm headers.
 * The answers come last, one at a time at full width. Near-miss cases have no checks, only the answer.
 */
export function CaseDetail({ prompt, arms, find, runDir }: { prompt?: string; arms: EvalArm[]; find: (arm: EvalArm) => EvalCaseArmResult | undefined; runDir: string }) {
  const withAnswers = arms.filter((a) => find(a)?.answerFile);
  const [shown, setShown] = useState<EvalArm>(withAnswers[0] ?? arms[0]!);
  const checks = arms.map((a) => find(a)?.expectations ?? []).reduce((a, b) => (b.length > a.length ? b : a), [] as ExpectationResult[]);
  const cols = arms.length > 1 ? 'grid gap-x-8 gap-y-1.5 sm:grid-cols-2' : 'grid';
  const answer = find(shown)?.answerFile;
  return (
    <div className="flex flex-col gap-5 break-words">
      <section>
        <h4 className="mb-1 text-caption font-semibold text-muted">Prompt</h4>
        <p className="max-w-[80ch] whitespace-pre-wrap">{prompt ?? 'Prompt not found in evals.json.'}</p>
      </section>

      <div className={cols}>{arms.map((a) => <ArmHeader key={a} arm={a} result={find(a)} />)}</div>

      {checks.length > 0 && (
        <section>
          <h4 className="mb-1 text-caption font-semibold text-muted">Checks</h4>
          <div className="overflow-hidden rounded-md border border-line bg-surface">
          {arms.length > 1 && <div className={clsx('hidden border-b border-line bg-panel px-3 py-1.5 text-caption font-medium text-muted sm:grid', cols)}>{arms.map((a) => <span key={a} className="pl-[22px]">{ARM_LABEL[a]}</span>)}</div>}
          <ol className="divide-y divide-line">
            {checks.map((c, i) => (
              <li key={i} className="px-3 py-2.5">
                <p className="max-w-[80ch]">{c.text}</p>
                <div className={clsx('mt-1.5', cols)}>{arms.map((a) => <Verdict key={a} e={find(a)?.expectations[i]} label={arms.length > 1 ? ARM_LABEL[a] : undefined} />)}</div>
              </li>
            ))}
          </ol>
          </div>
        </section>
      )}

      {withAnswers.length > 0 && (
        <section>
          <div className="mb-2 flex min-h-7 items-center justify-between gap-3">
            <h4 className="text-caption font-semibold text-muted">Answer</h4>
            {withAnswers.length > 1 && <Segmented label="Answer to show" value={shown} onChange={setShown} options={withAnswers.map((a) => ({ value: a, label: ARM_LABEL[a] }))} />}
          </div>
          {answer ? <Answer path={`${runDir}/${answer}`} /> : <p className="text-muted">{ARM_LABEL[shown]}: no answer.</p>}
        </section>
      )}
    </div>
  );
}
