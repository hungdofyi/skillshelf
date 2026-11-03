import { Fragment } from 'react';
import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import type { EvalArm, EvalCaseArmResult, EvalRun } from '@b2s/shared';
import { CaseDetail } from './case-detail';
import { ARM_LABEL, ResultPill, checksOf } from './eval-bits';

/** Checks gained (or lost) with the skill on one case; empty until both arms are graded. */
function Difference({ withSkill, baseline }: { withSkill?: EvalCaseArmResult; baseline?: EvalCaseArmResult }) {
  const a = withSkill && checksOf(withSkill);
  const b = baseline && checksOf(baseline);
  if (!a || !b) return null;
  const d = a.passed - b.passed;
  if (d === 0) return <span className="text-caption text-muted">same</span>;
  return <span className={clsx('tnum font-medium', d > 0 ? 'text-ok' : 'text-danger')}>{d > 0 ? '+' : '−'}{Math.abs(d)}</span>;
}

/**
 * Cases x arms with expandable evidence. `nearMiss` lists prompts the skill should leave alone: only the
 * with-skill arm runs for those, so there is no baseline or difference column.
 */
export function CasesTable({ run, ids, prompts, open, onToggle, nearMiss, runDir }: {
  run: EvalRun;
  ids: string[];
  prompts: Map<string, string>;
  open: Set<string>;
  onToggle: (id: string) => void;
  nearMiss?: boolean;
  runDir: string;
}) {
  const active = run.status === 'running';
  const arms: EvalArm[] = nearMiss ? run.arms.filter((a) => a === 'with_skill') : run.arms;
  const compare = !nearMiss && arms.includes('with_skill') && arms.includes('baseline');
  const find = (id: string, arm: EvalArm) => run.results.find((r) => r.caseId === id && r.arm === arm);
  return (
    <div className="overflow-hidden rounded-lg shadow-raised">
      {/* Fixed layout: column widths come from the header, so wide answer content (a Markdown table, a
          long code line) scrolls inside its own box instead of stretching the table past the page. */}
      <table className="w-full table-fixed border-collapse text-left">
        <thead><tr className="border-b border-line bg-panel text-caption text-muted">
          <th className="w-8" /><th className="px-3 py-1.5 font-medium">Case</th>
          {arms.map((a) => <th key={a} className="w-32 px-3 py-1.5 font-medium">{ARM_LABEL[a]}</th>)}
          {compare && <th className="w-24 px-3 py-1.5 font-medium" title="Checks passed with the skill minus checks passed without it">Difference</th>}
        </tr></thead>
        {/* No border under the last row: the card's own edge closes the table. */}
        <tbody className="[&>tr:last-child]:border-b-0">
          {ids.map((id) => {
            const isOpen = open.has(id);
            return (
              <Fragment key={id}>
                <tr id={`case-${id}`} className={clsx('cursor-pointer scroll-mt-4 border-b border-line hover:bg-hover', isOpen && 'bg-hover')} onClick={() => onToggle(id)}>
                  <td className="pl-2"><button aria-expanded={isOpen} aria-label={`Toggle case ${id}`} className="relative flex size-6 items-center justify-center rounded text-muted before:absolute before:-inset-2" onClick={(e) => { e.stopPropagation(); onToggle(id); }}><ChevronRight size={14} aria-hidden className={clsx('transition-[rotate] duration-150 ease-(--ease-move)', isOpen && 'rotate-90')} /></button></td>
                  <td className="px-3 py-2"><div className="truncate"><span className="mr-2 font-mono text-caption text-faint">#{id}</span>{prompts.get(id) ?? ''}</div></td>
                  {arms.map((a) => <td key={a} className="px-3 py-2"><ResultPill result={find(id, a)} runActive={active} /></td>)}
                  {compare && <td className="px-3 py-2"><Difference withSkill={find(id, 'with_skill')} baseline={find(id, 'baseline')} /></td>}
                </tr>
                {isOpen && (
                  <tr className="border-b border-line bg-panel"><td colSpan={2 + arms.length + (compare ? 1 : 0)} className="px-5 py-4">
                    <CaseDetail prompt={prompts.get(id)} arms={arms} find={(a) => find(id, a)} runDir={runDir} />
                  </td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
