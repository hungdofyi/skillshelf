import { Download } from 'lucide-react';
import { useFile } from '../api/queries';
import { rawUrl } from '../api/client';
import { extname } from '../lib/route';
import { formatBytes } from '../lib/format';
import { ErrorState, LoadingBlock } from '../components/ui/misc';

const IMAGES = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif']);

/** PDFs in an iframe, images inline, everything else as size + type. */
export function BinaryView({ path }: { path: string }) {
  const { data, isPending, error } = useFile(path);
  const ext = extname(path);
  if (isPending) return <LoadingBlock />;
  if (error || !data) return <ErrorState error={error} title="Could not open this file" />;
  const src = rawUrl(path);
  if (ext === 'pdf') return <iframe title={path} src={src} className="h-full w-full border-0 bg-sunken" />;
  if (IMAGES.has(ext)) {
    return (
      <div className="flex h-full items-center justify-center overflow-auto bg-sunken p-8">
        <img src={src} alt={path} className="img-outline max-h-full max-w-full rounded-md" />
      </div>
    );
  }
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-6 py-16 text-center">
      <h2 className="text-body font-semibold">No preview for this file</h2>
      <p className="text-muted"><span className="font-mono">{ext ? `.${ext}` : 'unknown type'}</span> · <span className="tnum">{formatBytes(data.size)}</span></p>
      <a href={src} download className="fx press mt-2 inline-flex h-8 items-center gap-2 rounded-md bg-raised px-3 font-medium shadow-raised hover:bg-raised-hover"><Download size={14} aria-hidden />Download</a>
    </div>
  );
}
