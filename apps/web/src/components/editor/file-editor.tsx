import { useDeferredValue, useMemo, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { Check, RotateCcw, Save, Wand2 } from 'lucide-react';
import { Button } from '../ui/button';
import { ErrorState, LoadingBlock, Pill, Segmented } from '../ui/misc';
import { MarkdownPreview } from '../markdown/markdown-preview';
import { CodeEditor, type EditorLanguage } from './code-editor';
import { useFileDraft } from './use-file-draft';
import { formatBytes } from '../../lib/format';
import { shortcutLabels } from '../../lib/use-global-shortcuts';
import { rawUrl } from '../../api/client';

type Mode = 'preview' | 'edit' | 'split';
export type PreviewKind = 'markdown' | 'json' | 'none';

function validateJson(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    return `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`;
  }
}

function JsonPretty({ text }: { text: string }) {
  const pretty = useMemo(() => {
    try {
      return { text: JSON.stringify(JSON.parse(text), null, 2), error: null as string | null };
    } catch (e) {
      return { text, error: e instanceof Error ? e.message : 'Invalid JSON' };
    }
  }, [text]);
  return (
    <div className="flex h-full flex-col">
      {pretty.error && <p className="border-b border-line bg-warn-soft px-4 py-1.5 text-warn">Not valid JSON: {pretty.error}</p>}
      <div className="min-h-0 flex-1">
        <CodeEditor value={pretty.text} onChange={() => {}} language="json" readOnly ariaLabel="Formatted JSON" />
      </div>
    </div>
  );
}

/**
 * One file, three ways to look at it: preview, edit, split. Handles save, conflicts and unsaved state.
 * `leading` fills the start of the toolbar (the file view puts its breadcrumb there); `inspector` hands
 * the frontmatter to the right-hand inspector.
 */
export function FileEditor({ path, kind, leading, inspector }: { path: string; kind: PreviewKind; leading?: ReactNode; inspector?: boolean }) {
  const language: EditorLanguage = kind === 'markdown' ? 'markdown' : kind === 'json' ? 'json' : 'text';
  const [mode, setMode] = useState<Mode>(kind === 'none' ? 'edit' : 'preview');
  const d = useFileDraft(path, kind === 'json' ? validateJson : undefined);
  const deferred = useDeferredValue(d.text);
  const { data: file, isPending, error } = d.query;

  if (isPending) return <LoadingBlock />;
  if (error || !file) return <ErrorState error={error} title="Could not open this file" />;
  if (file.binary) {
    return (
      <ErrorState
        title="Binary file"
        error={`${formatBytes(file.size)}. It cannot be shown as text.`}
        action={<a className="text-accent underline" href={rawUrl(path)} target="_blank" rel="noreferrer">Open raw</a>}
      />
    );
  }

  const editor = <CodeEditor value={d.text} onChange={d.edit} onSave={d.save} language={language} ariaLabel={`Edit ${path}`} />;
  const preview = kind === 'markdown' ? <MarkdownPreview source={deferred} filePath={path} outline={mode === 'preview'} frontmatterInInspector={inspector} /> : <JsonPretty text={deferred} />;
  const modes = [
    { value: 'preview' as const, label: 'Preview' },
    { value: 'edit' as const, label: 'Edit' },
    ...(kind === 'markdown' ? [{ value: 'split' as const, label: 'Split' }] : []),
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="hairline-b flex h-10 shrink-0 items-center gap-3 px-4">
        {leading && <div className="min-w-0 flex-1">{leading}</div>}
        {kind !== 'none' && (
          <Segmented label="View mode" value={mode} onChange={setMode} options={modes} />
        )}
        {d.dirty ? <Pill tone="warn">Unsaved</Pill> : <span className="flex shrink-0 items-center gap-1 text-caption text-faint"><Check size={12} aria-hidden />Saved</span>}
        {d.changedOnDisk && <Pill tone="danger">Changed on disk</Pill>}
        {d.validationError && <span className="truncate text-caption text-danger">{d.validationError}</span>}
        <div className={clsx('flex shrink-0 items-center gap-1.5', !leading && 'ml-auto')}>
          {kind === 'json' && mode !== 'preview' && (
            <Button size="sm" variant="ghost" icon={<Wand2 size={13} />} onClick={() => { try { d.edit(JSON.stringify(JSON.parse(d.text), null, 2) + '\n'); } catch { /* validation message already shown */ } }}>
              Format
            </Button>
          )}
          {/* Save appears with the first edit; while clean, "Saved" already says everything. */}
          {(d.dirty || d.saving) && (
            <>
              <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={d.revert}>Revert</Button>
              <Button size="sm" variant="primary" icon={<Save size={13} />} disabled={!!d.validationError} loading={d.saving} onClick={d.save} title={`Save (${shortcutLabels.mod}S)`}>
                Save
              </Button>
            </>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {mode === 'preview' && preview}
        {mode === 'edit' && editor}
        {mode === 'split' && (
          <div className="grid h-full grid-cols-2 divide-x divide-line">
            <div className="min-w-0 overflow-hidden">{editor}</div>
            <div className="min-w-0 overflow-hidden">{preview}</div>
          </div>
        )}
      </div>
    </div>
  );
}

