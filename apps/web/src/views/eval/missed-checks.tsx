import { PenLine } from 'lucide-react';
import type { EvalRun } from '@b2s/shared';
import { navigate } from '../../lib/location-state';
import { Button } from '../../components/ui/button';
import { SectionTitle } from '../../components/ui/misc';
import { checksOf } from './eval-bits';

/**
 * Every check the with-skill answers missed, one line each, in case order. Clicking a line opens its case;
 * the button opens the Revise tab with this run picked, so the failures feed the next revision.
 */
export function MissedChecks({ run, skill, caseIds, onOpenCase }: { run: EvalRun; skill: string; caseIds: string[]; onOpenCase: (id: string) => void }) {
  const order = new Map(caseIds.map((id, i) => [id, i]));
  const missed = run.results
    .filter((r) => r.arm === 'with_skill' && checksOf(r))
    .sort((a, b) => (order.get(a.caseId) ?? 0) - (order.get(b.caseId) ?? 0))
    .flatMap((r) => r.expectations.filter((e) => !e.passed).map((e) => ({ caseId: r.caseId, text: e.text })));
  if (!missed.length) return null;
  return (
    <section>
      <SectionTitle aside={run.status === 'succeeded' && <Button size="sm" icon={<PenLine size={13} />} onClick={() => navigate(`skills/${skill}`, { tab: 'revise', run: run.id })}>Revise using these</Button>}>
        What the skill still misses ({missed.length})
      </SectionTitle>
      <ul className="divide-y divide-line overflow-hidden rounded-lg shadow-raised">
        {missed.map((m, i) => (
          <li key={i}>
            <button className="fx flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-hover" onClick={() => onOpenCase(m.caseId)}>
              <span className="mt-px shrink-0 font-mono text-caption text-faint">#{m.caseId}</span>
              <span className="min-w-0">{m.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
