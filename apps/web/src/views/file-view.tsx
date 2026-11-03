import { useFile } from '../api/queries';
import { FileEditor, type PreviewKind } from '../components/editor/file-editor';
import { ErrorState, LoadingBlock } from '../components/ui/misc';
import { extname, isMarkdownPath } from '../lib/route';
import { BinaryView } from './binary-view';
import { Breadcrumb } from './breadcrumb';

/** Chooses markdown / json / text editor or binary preview from the server's `binary` flag and extension. */
export function FileView({ path }: { path: string }) {
  const { data, isPending, error } = useFile(path);
  if (isPending) return <LoadingBlock />;
  if (error || !data) return <ErrorState error={error} title="Could not open this file" />;
  if (data.binary) {
    return (
      <div className="flex h-full flex-col">
        <Breadcrumb path={path} />
        <div className="min-h-0 flex-1"><BinaryView path={path} /></div>
      </div>
    );
  }
  const ext = extname(path);
  const kind: PreviewKind = isMarkdownPath(path) ? 'markdown' : ext === 'json' ? 'json' : 'none';
  return <FileEditor path={path} kind={kind} leading={<Breadcrumb path={path} inline />} inspector />;
}
