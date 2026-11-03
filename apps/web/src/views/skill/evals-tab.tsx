import { useState } from 'react';
import type { SkillSummary } from '@b2s/shared';
import { EvalCasesEditor } from './eval-cases-editor';
import { RunEvalsPanel } from './run-evals-panel';
import { RunsHistory } from './runs-history';

export function EvalsTab({ skill }: { skill: SkillSummary }) {
  const [dirty, setDirty] = useState(false);
  return (
    <div className="page-column flex flex-col gap-8 py-6">
      <RunEvalsPanel skill={skill.name} caseCount={skill.evalCount} blockedReason={dirty ? 'Save your eval changes before running.' : undefined} />
      <RunsHistory skill={skill.name} />
      <EvalCasesEditor skill={skill.name} skillPath={skill.path} onDirty={setDirty} />
    </div>
  );
}
