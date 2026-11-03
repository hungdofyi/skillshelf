import { useCallback, useEffect, useRef, useState } from 'react';

const FADE_PX = 40;
// Eased (ease-in-out cubic) stops: a linear ramp shows a visible edge where the fade starts.
const EASE = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((t) => [t, t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2] as const);

/** Mask that fades whichever edge has more content beyond it. */
function overflowMask(left: boolean, right: boolean): string | undefined {
  if (!left && !right) return undefined;
  const leftStops = left ? EASE.map(([t, a]) => `rgb(0 0 0 / ${a.toFixed(3)}) ${(t * FADE_PX).toFixed(1)}px`) : ['black 0px'];
  // Right edge: t is the distance in from the edge, so stops are listed edge-last.
  const rightStops = right ? EASE.map(([t, a]) => `rgb(0 0 0 / ${a.toFixed(3)}) calc(100% - ${(t * FADE_PX).toFixed(1)}px)`).reverse() : ['black 100%'];
  return `linear-gradient(to right, ${leftStops.join(', ')}, ${rightStops.join(', ')})`;
}

/**
 * Horizontal strip that hides its scrollbar: fades the overflowing edges with an eased mask and exposes
 * page-left / page-right for hover buttons. `wheel` turns a vertical mouse wheel into sideways scrolling;
 * only use it where the strip is not inside a vertical scroller (it would trap page scrolling).
 */
export function useHorizontalOverflow<T extends HTMLElement>(contentKey: unknown, opts?: { wheel?: boolean }) {
  const wheel = !!opts?.wheel;
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('scroll', measure, { passive: true });
    if (wheel) el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', measure);
      el.removeEventListener('wheel', onWheel);
    };
  }, [measure, wheel]);

  // Tabs opening or closing change the scroll width without resizing the strip itself.
  useEffect(() => {
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [contentKey, measure]);

  const page = useCallback((dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  return { ref, canLeft: edges.left, canRight: edges.right, page, mask: overflowMask(edges.left, edges.right) };
}
