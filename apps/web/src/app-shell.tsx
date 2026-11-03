import { lazy, Suspense, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useTree } from './api/queries';
import { useLocationState, useNavigationGuards } from './lib/location-state';
import { openTab, pruneTabs } from './lib/open-tabs-store';
import { findNode } from './lib/route';
import { setUi, useUi } from './lib/ui-store';
import { useGlobalShortcuts } from './lib/use-global-shortcuts';
import { AppRail } from './components/shell/app-rail';
import { Sidebar } from './components/shell/sidebar';
import { DocumentTabs } from './components/shell/document-tabs';
import { StatusBar } from './components/shell/status-bar';
import { useCollapsiblePanel } from './components/shell/use-collapsible-panel';
import { JobsDrawer } from './components/jobs/jobs-drawer';
import { ConnectDialog } from './components/connect/connect-dialog';
import { SummarizeDialog } from './views/book/summarize-dialog';
import { CreateSkillDialog } from './components/skill/create-skill-dialog';
import { MainPane } from './views/main-pane';

// The inspector pulls in YAML parsing and view-specific panels; load it after the shell paints.
const Inspector = lazy(() => import('./components/inspector/inspector').then((m) => ({ default: m.Inspector })));

/**
 * Six regions: rail | sidebar | (tabs + main + jobs drawer) | inspector, with the status bar under
 * everything. Regions meet at hairlines; sidebar, inspector and drawer collapse to zero.
 */
export function AppShell() {
  useNavigationGuards();
  const { path } = useLocationState();
  const { data: tree } = useTree();
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const inspectorOpen = useUi((s) => s.inspectorOpen);
  const jobsOpen = useUi((s) => s.jobsOpen);
  const connectOpen = useUi((s) => s.connectOpen);
  const createFor = useUi((s) => s.createSkillFor);
  const summarizeFor = useUi((s) => s.summarizeFor);
  useGlobalShortcuts(path);

  // Every navigation opens (or focuses) a document tab; the URL stays the source of truth.
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    openTab(path, lastPath.current);
    if (path) lastPath.current = path;
  }, [path]);
  useEffect(() => {
    if (tree) pruneTabs((p) => findNode(tree.root, p) !== null, path);
  }, [tree, path]);

  const sidebar = useCollapsiblePanel(sidebarOpen, { expandTo: '264px', minPx: 200, enter: 'enter-from-left' });
  const inspector = useCollapsiblePanel(inspectorOpen, { expandTo: '300px', minPx: 240, enter: 'enter-from-right' });
  const drawer = useCollapsiblePanel(jobsOpen, { expandTo: '260px', minPx: 120, enter: 'enter-from-below' });

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <AppRail />
        <Group orientation="horizontal" className="min-w-0 flex-1" id="shell-h">
          <Panel
            id="sidebar" panelRef={sidebar.panelRef} defaultSize={sidebarOpen ? '264px' : '0px'} minSize="200px" maxSize="480px"
            collapsible collapsedSize="0px" groupResizeBehavior="preserve-pixel-size"
            onResize={(size) => { const open = size.inPixels > 0; if (open !== sidebarOpen) setUi({ sidebarOpen: open }); }}
          >
            <div ref={sidebar.contentRef} className="h-full">{sidebarOpen && <Sidebar />}</div>
          </Panel>
          <Separator className={clsx(!sidebarOpen && 'opacity-0')} />
          <Panel id="workspace" minSize="360px">
            <Group orientation="vertical" id="shell-v">
              <Panel id="main" minSize="160px">
                <div className="flex h-full min-h-0 flex-col bg-surface">
                  <DocumentTabs activePath={path} />
                  <div className="min-h-0 flex-1"><MainPane /></div>
                </div>
              </Panel>
              <Separator className={clsx(!jobsOpen && 'opacity-0')} />
              <Panel
                id="jobs" panelRef={drawer.panelRef} defaultSize="0px" collapsedSize="0px" minSize="120px" collapsible
                onResize={(size) => { if (size.inPixels === 0 && jobsOpen) setUi({ jobsOpen: false }); }}
              >
                <div ref={drawer.contentRef} className="h-full">{jobsOpen && <JobsDrawer />}</div>
              </Panel>
            </Group>
          </Panel>
          <Separator className={clsx(!inspectorOpen && 'opacity-0')} />
          <Panel
            id="inspector" panelRef={inspector.panelRef} defaultSize={inspectorOpen ? '300px' : '0px'} minSize="240px" maxSize="520px"
            collapsible collapsedSize="0px" groupResizeBehavior="preserve-pixel-size"
            onResize={(size) => { const open = size.inPixels > 0; if (open !== inspectorOpen) setUi({ inspectorOpen: open }); }}
          >
            <div ref={inspector.contentRef} className="h-full">{inspectorOpen && <Suspense fallback={<div className="h-full bg-panel" />}><Inspector path={path} /></Suspense>}</div>
          </Panel>
        </Group>
      </div>
      <StatusBar path={path} />
      <ConnectDialog open={connectOpen} onOpenChange={(o) => setUi({ connectOpen: o })} />
      {summarizeFor !== false && <SummarizeDialog slug={summarizeFor} onClose={() => setUi({ summarizeFor: false })} />}
      {createFor !== false && <CreateSkillDialog preselect={createFor} onClose={() => setUi({ createSkillFor: false })} />}
    </div>
  );
}
