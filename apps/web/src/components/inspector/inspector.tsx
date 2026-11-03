import { useTree } from '../../api/queries';
import { findNode, resolveRoute } from '../../lib/route';
import { BookInspector } from './book-inspector';
import { EvalRunInspector } from './eval-run-inspector';
import { FileInspector } from './file-inspector';
import { SkillInspector } from './skill-inspector';
import { InspectorNote } from './inspector-section';

const TITLE = { home: 'Inspector', book: 'Book', skill: 'Skill', 'eval-run': 'Eval run', folder: 'Folder', file: 'File' } as const;

/** Right-hand context for the active document. Its header lines up with the tab bar. */
export function Inspector({ path }: { path: string }) {
  const { data: tree } = useTree();
  const route = resolveRoute(path, tree?.root);
  let body;
  switch (route.kind) {
    case 'home': body = <InspectorNote>Open a book, skill, eval run or file to see its details here.</InspectorNote>; break;
    case 'book': body = <BookInspector key={route.slug} slug={route.slug} />; break;
    case 'skill': body = <SkillInspector key={route.name} name={route.name} />; break;
    case 'eval-run': body = <EvalRunInspector key={route.runId} skill={route.skill} runId={route.runId} />; break;
    case 'folder': {
      const n = findNode(tree?.root, route.path)?.children?.length ?? 0;
      body = <InspectorNote>{n === 0 ? 'Empty folder.' : `${n} item${n === 1 ? '' : 's'} in this folder.`}</InspectorNote>;
      break;
    }
    case 'file': body = <FileInspector key={route.path} path={route.path} />; break;
  }
  return (
    <aside aria-label="Inspector" className="flex h-full min-h-0 flex-col bg-panel">
      <div className="hairline-b flex h-10 shrink-0 items-center px-4">
        <h2 className="text-ui font-semibold">{TITLE[route.kind]}</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">{body}</div>
    </aside>
  );
}
