import { useMemo, useState } from 'react';
import { parseFrontmatter } from '../../lib/frontmatter';
import { FrontmatterCard } from './frontmatter-card';
import { MarkdownBody } from './markdown-body';
import { OutlineOverlay } from './outline';

/**
 * Scrollable reading pane with a centred text column. The outline floats over the right edge
 * (absolutely positioned, never pushing the column). `frontmatterInInspector` leaves the frontmatter
 * to the inspector instead of drawing it above the body.
 */
export function MarkdownPreview({ source, filePath, outline = true, frontmatterInInspector = false }: { source: string; filePath: string; outline?: boolean; frontmatterInInspector?: boolean }) {
  const parsed = useMemo(() => parseFrontmatter(source), [source]);
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  return (
    <div className="@container relative h-full">
      <div ref={setScrollEl} className="h-full overflow-y-auto">
        <article className="mx-auto w-full max-w-[720px] px-8 pb-24 pt-8">
          {!frontmatterInInspector && <FrontmatterCard data={parsed.data} error={parsed.error} />}
          <MarkdownBody source={parsed.body} filePath={filePath} />
        </article>
      </div>
      {outline && <OutlineOverlay container={scrollEl} version={source} />}
    </div>
  );
}
