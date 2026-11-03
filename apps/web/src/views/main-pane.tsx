import { lazy, Suspense } from 'react';
import { BookOpen } from 'lucide-react';
import { useTree } from '../api/queries';
import { resolveRoute } from '../lib/route';
import { useLocationState } from '../lib/location-state';
import { shortcutLabels } from '../lib/use-global-shortcuts';
import { EmptyState, LoadingBlock } from '../components/ui/misc';
import { Breadcrumb } from './breadcrumb';
import { FolderView } from './folder-view';

// Heavy views (CodeMirror, Markdown) load on first use to keep the shell fast.
const BookView = lazy(() => import('./book/book-view').then((m) => ({ default: m.BookView })));
const SkillView = lazy(() => import('./skill/skill-view').then((m) => ({ default: m.SkillView })));
const EvalRunView = lazy(() => import('./eval/eval-run-view').then((m) => ({ default: m.EvalRunView })));
const FileView = lazy(() => import('./file-view').then((m) => ({ default: m.FileView })));

function Home({ hasContent }: { hasContent: boolean }) {
  return hasContent ? (
    <EmptyState icon={<BookOpen size={24} />} title="Nothing open">
      Open a book, skill or eval run from the sidebar, or press {shortcutLabels.quickOpen} to find a file by name.
    </EmptyState>
  ) : (
    <EmptyState icon={<BookOpen size={24} />} title="Your library is empty">
      Import a PDF or EPUB from the Books panel. It is split into chapters, and you can create a skill from it.
    </EmptyState>
  );
}

/** Picks the view for the `?path=` selection. File views put the breadcrumb in their own toolbar. */
export function MainPane() {
  const { path } = useLocationState();
  const { data } = useTree();
  const route = resolveRoute(path, data?.root);
  let body;
  switch (route.kind) {
    case 'home': body = <Home hasContent={(data?.root.children ?? []).some((c) => (c.children?.length ?? 0) > 0)} />; break;
    case 'book': body = <BookView key={route.slug} slug={route.slug} />; break;
    case 'skill': body = <SkillView key={route.name} name={route.name} isSkillMd={route.isSkillMd} />; break;
    case 'eval-run': body = <EvalRunView key={`${route.skill}/${route.runId}`} skill={route.skill} runId={route.runId} />; break;
    case 'folder': body = <FolderView path={route.path} />; break;
    case 'file': body = <FileView key={route.path} path={route.path} />; break;
  }
  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col bg-surface">
      {path && route.kind !== 'file' && <Breadcrumb path={path} />}
      <div className="min-h-0 flex-1"><Suspense fallback={<LoadingBlock />}>{body}</Suspense></div>
    </main>
  );
}
