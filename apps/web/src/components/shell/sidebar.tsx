import { useLocationState } from '../../lib/location-state';
import { useUi } from '../../lib/ui-store';
import { FileTree } from '../tree/file-tree';
import { BooksPanel } from '../sidebar/books-panel';
import { SkillsPanel } from '../sidebar/skills-panel';
import { EvalsPanel } from '../sidebar/evals-panel';
import { QuickOpenPanel } from '../sidebar/quick-open-panel';
import { ActivityPanel } from '../sidebar/activity-panel';

const LABEL = { library: 'Library', books: 'Books', skills: 'Skills', evals: 'Evals', search: 'Search', activity: 'Activity' } as const;

/** The panel the rail selected. Every panel starts with a SidebarHeader row. */
export function Sidebar() {
  const rail = useUi((s) => s.rail);
  const { path } = useLocationState();
  if (rail === 'library') return <FileTree selectedPath={path} />;
  return (
    <aside aria-label={LABEL[rail]} className="flex h-full min-h-0 flex-col bg-panel">
      {rail === 'books' && <BooksPanel activePath={path} />}
      {rail === 'skills' && <SkillsPanel activePath={path} />}
      {rail === 'evals' && <EvalsPanel activePath={path} />}
      {rail === 'search' && <QuickOpenPanel />}
      {rail === 'activity' && <ActivityPanel />}
    </aside>
  );
}
