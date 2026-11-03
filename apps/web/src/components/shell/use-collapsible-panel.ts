import { useEffect, useRef } from 'react';
import { usePanelRef } from 'react-resizable-panels';
import { getUi } from '../../lib/ui-store';

export type EnterFrom = 'enter-from-left' | 'enter-from-right' | 'enter-from-below';

/** Restart a one-shot CSS entrance on `el` (the class is removed again when it finishes). */
function replayEnter(el: HTMLElement | null, cls: EnterFrom): void {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // reflow so the same animation can play again
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

/**
 * Keeps a collapsible panel in step with an `open` flag from the UI store. The panel geometry snaps
 * (animating width would run layout every frame); its content slides 8px in from the panel's edge
 * so the eye sees where it came from. Keyboard toggles skip the slide.
 */
export function useCollapsiblePanel(open: boolean, opts: { expandTo: string; minPx: number; enter: EnterFrom }) {
  const panelRef = usePanelRef();
  const contentRef = useRef<HTMLDivElement>(null);
  const { expandTo, minPx, enter } = opts;

  useEffect(() => {
    const p = panelRef.current;
    if (!p) return;
    if (open) {
      const wasCollapsed = p.isCollapsed();
      if (wasCollapsed) p.expand();
      if (p.getSize().inPixels < minPx) p.resize(expandTo);
      if (wasCollapsed && !getUi().instantPanels) replayEnter(contentRef.current, enter);
    } else if (!p.isCollapsed()) {
      p.collapse();
    }
  }, [open, panelRef, expandTo, minPx, enter]);

  return { panelRef, contentRef };
}
