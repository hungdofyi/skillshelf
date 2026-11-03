import { Check, X } from 'lucide-react';
import type { EvalCaseArmResult } from '@b2s/shared';
import { useFile } from '../../api/queries';
import { MarkdownBody } from '../../components/markdown/markdown-body';
import { formatDuration } from '../../lib/format';
import { CaseStatusPill, ARM_LABEL } from './eval-bits';
import { Pill } from '../../components/ui/misc';

function Answer({ path }: { path: string }) {
  const { data, isPending, error } = useFile(path);
  if (isPending) return <p className="text-muted">Loading answer…</p>;
  if (error || data?.content === undefined) return <p className="text-muted">Answer file not available.</p>;
  return <div className="max-h-96 overflow-y-auto rounded-md border border-line bg-surface p-4"><div className="prose-compact"><MarkdownBody source={data.content} filePath={path} /></div></div>;
}

export function ArmDetail({ result, runDir }: { result: EvalCaseArmResult; runDir: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h4 className="font-medium">{ARM_LABEL[result.arm]}</h4>
        <CaseStatusPill result={result} runActive={false} />
        {result.arm === 'with_skill' && result.triggered !== undefined && <Pill tone={result.triggered ? 'ok' : 'warn'}>{result.triggered ? 'Skill triggered' : 'Skill not triggered'}</Pill>}
        <span className="tnum text-caption text-muted">score {result.score.toFixed(2)}{result.durationMs !== undefined && ` · ${formatDuration(result.durationMs)}`}{result.numTurns !== undefined && ` · ${result.numTurns} turns`}</span>
      </div>
      {result.error && <p className="mb-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-danger">{result.error}</p>}
      {result.judgeSummary && <p className="mb-2 text-muted">{result.judgeSummary}</p>}
      <ul className="mb-3 flex flex-col gap-1.5">
        {result.expectations.map((e, i) => (
          <li key={i} className="flex items-start gap-2">
            {e.passed ? <Check size={14} className="mt-0.5 shrink-0 text-ok" aria-label="Passed" /> : <X size={14} className="mt-0.5 shrink-0 text-danger" aria-label="Failed" />}
            <div className="min-w-0"><div>{e.text}</div>{e.evidence && <div className="mt-0.5 text-caption italic text-muted">{e.evidence}</div>}</div>
          </li>
        ))}
        {!result.expectations.length && <li className="text-muted">No expectations were graded.</li>}
      </ul>
      {result.answerFile && <Answer path={`${runDir}/${result.answerFile}`} />}
    </div>
  );
}
