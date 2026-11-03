/**
 * Magnetic indicator shared by Segmented and Tabs.
 *
 * - Active indicator: one element per group (Motion `layoutId`) that glides to the selected item.
 * - Magnetic hover: a soft highlight that follows the mouse between items and fades when it leaves the
 *   group. Entering the group fresh fades it in in place (no slide from a stale position).
 *
 * Rules (emil-animations): springs without bounce, ~250ms, interruptible; keyboard-initiated changes
 * snap (never animate keyboard navigation); prefers-reduced-motion disables all motion; hover only
 * reacts to a real mouse. Layout animations only move transforms; radius/shadow go through `style`
 * so Motion corrects them while the element scales.
 */
import { createContext, useContext, useId, useMemo, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { LayoutGroup, LazyMotion, m, useReducedMotion, type Transition } from 'motion/react';

const loadMotionFeatures = () => import('../shell/motion-features').then((r) => r.default);

// Something already on screen moving to a new spot: spring, no bounce, keeps velocity when retargeted.
const SLIDE: Transition = { type: 'spring', duration: 0.25, bounce: 0 };
const HOVER_SLIDE: Transition = { type: 'spring', duration: 0.2, bounce: 0 };
const FADE: Transition = { duration: 0.12, ease: 'easeOut' };
const INSTANT: Transition = { duration: 0 };

interface HoverState { value: string | null; visible: boolean; slide: boolean }
interface MagneticCtx {
  id: string;
  hover: HoverState;
  enter: (value: string) => void;
  keyboard: boolean;
  reduced: boolean;
}

const Ctx = createContext<MagneticCtx | null>(null);

// Last input modality on <html data-input>: theme.css hides the focus ring in magnetic groups after a mouse
// click (Radix focuses the tab on pointer down, which the browser treats as focus-visible) but keeps it for
// keyboard users, including when Tab moves focus in from outside the group.
if (typeof document !== 'undefined' && !document.documentElement.dataset.input) {
  const root = document.documentElement;
  root.dataset.input = 'pointer';
  document.addEventListener('keydown', () => { root.dataset.input = 'keyboard'; }, true);
  document.addEventListener('pointerdown', () => { root.dataset.input = 'pointer'; }, true);
}

/** Group state + the handlers to spread on the group container (tab list / radiogroup). */
export function useMagneticGroup() {
  const id = useId();
  const reduced = !!useReducedMotion();
  const [hover, setHover] = useState<HoverState>({ value: null, visible: false, slide: false });
  const [keyboard, setKeyboard] = useState(false);
  const ctx = useMemo<MagneticCtx>(() => ({
    id,
    hover,
    keyboard,
    reduced,
    // Slide only when moving between items; a fresh entry appears in place.
    enter: (value) => setHover((p) => ({ value, visible: true, slide: p.visible })),
  }), [id, hover, keyboard, reduced]);
  const containerProps = {
    // Hook for theme.css focus rules; spread `isolate` (via the container's class) so layer z-indices stay local.
    'data-magnetic': '',
    onPointerLeave: () => setHover((p) => ({ ...p, visible: false, slide: false })),
    onPointerDownCapture: () => setKeyboard(false),
    onKeyDownCapture: () => setKeyboard(true),
  };
  return { ctx, containerProps };
}

export function MagneticProvider({ value, children }: { value: MagneticCtx; children: ReactNode }) {
  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <LayoutGroup id={value.id}>
        <Ctx.Provider value={value}>{children}</Ctx.Provider>
      </LayoutGroup>
    </LazyMotion>
  );
}

function useMagnetic(): MagneticCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('Magnetic items must be inside a MagneticProvider');
  return c;
}

/** Spread on each item: mouse-only hover tracking (touch "hover" on tap is ignored). */
export function useMagneticHover(value: string) {
  const c = useMagnetic();
  return { onPointerEnter: (e: PointerEvent) => { if (e.pointerType === 'mouse') c.enter(value); } };
}

interface LayerStyle { className: string; style?: CSSProperties }

/**
 * Render inside each (position: relative) item, before its label. Hover sits at z-0, the active indicator at
 * z-1 (a gliding highlight never tints it), and labels must be `relative z-10`: the gliding element belongs to the item it moves to, so without explicit z-order it would
 * pass over labels when moving right (later in the DOM) and under them when moving left.
 */
export function MagneticLayers({ value, active, activeLayer, hoverLayer }: { value: string; active: boolean; activeLayer: LayerStyle; hoverLayer: LayerStyle }) {
  const c = useMagnetic();
  const move = c.reduced || c.keyboard ? INSTANT : SLIDE;
  const hoverMove = c.reduced || !c.hover.slide ? INSTANT : HOVER_SLIDE;
  return (
    <>
      {c.hover.value === value && (
        <m.span
          aria-hidden
          layoutId={`${c.id}-hover`}
          className={`z-0 ${hoverLayer.className}`}
          style={hoverLayer.style}
          initial={{ opacity: c.hover.slide || c.reduced ? 1 : 0 }}
          animate={{ opacity: c.hover.visible ? 1 : 0 }}
          transition={{ layout: hoverMove, opacity: c.reduced ? INSTANT : FADE }}
        />
      )}
      {active && (
        <m.span aria-hidden layoutId={`${c.id}-active`} className={`z-[1] ${activeLayer.className}`} style={activeLayer.style} transition={{ layout: move }} />
      )}
    </>
  );
}
