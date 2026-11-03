import { useMemo, type ReactNode } from 'react';
import { useFile, useTree } from '../../api/queries';
import { countText, formatBytes, formatNumber, formatTime } from '../../lib/format';
import { parseFrontmatter } from '../../lib/frontmatter';
import { extname, findNode, isMarkdownPath } from '../../lib/route';
import { FrontmatterList } from '../markdown/frontmatter-card';
import { InspectorFacts, InspectorNote, InspectorSection } from './inspector-section';

const GIT_LABEL = { modified: 'Modified', added: 'Added', untracked: 'Untracked', deleted: 'Deleted', renamed: 'Renamed', ignored: 'Ignored' } as const;

/** Any file: frontmatter for Markdown, then size, dates, counts and git state. The outline floats in the page. */
export function FileInspector({ path }: { path: string }) {
  const { data: file, isPending } = useFile(path);
  const { data: tree } = useTree();
  const markdown = isMarkdownPath(path);
  const parsed = useMemo(() => (markdown && file?.content !== undefined ? parseFrontmatter(file.content) : null), [markdown, file?.content]);
  const counts = useMemo(() => (file?.content !== undefined ? countText(file.content) : null), [file?.content]);
  const git = findNode(tree?.root, path)?.git;
  if (isPending) return <InspectorNote>Loading…</InspectorNote>;
  if (!file) return <InspectorNote>This file could not be read.</InspectorNote>;

  return (
    <>
      {(parsed?.data || parsed?.error) && (
        <InspectorSection title="Frontmatter">
          <FrontmatterList data={parsed.data} error={parsed.error} stacked />
        </InspectorSection>
      )}
      <InspectorSection title="File">
        <InspectorFacts items={[
          ['Type', file.binary ? (extname(path) ? `.${extname(path)}` : 'Binary') : markdown ? 'Markdown' : extname(path) === 'json' ? 'JSON' : 'Text'],
          ['Size', <span className="tnum">{formatBytes(file.size)}</span>],
          ['Modified', formatTime(new Date(file.mtimeMs).toISOString())],
          ...(counts ? ([['Words', <span className="tnum">{formatNumber(counts.words)}</span>], ['Lines', <span className="tnum">{formatNumber(counts.lines)}</span>]] as Array<[string, ReactNode]>) : []),
          ...(git ? ([['Git', GIT_LABEL[git]]] as Array<[string, string]>) : []),
        ]} />
      </InspectorSection>
    </>
  );
}
