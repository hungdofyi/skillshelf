import { useEffect } from 'react';
import { getUi, openQuickOpen, RAIL_VIEWS, selectRail, setUi } from './ui-store';
import { closeTab } from './open-tabs-store';

const isMac = typeof navigator !== 'undefined' && /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/**
 * Shortcut labels for the user's OS. Rail views use ⌃1–⌃6 on macOS and Alt+1–6 elsewhere,
 * because Ctrl/⌘+digit is the browser's own tab switcher.
 */
export const shortcutLabels = {
  mod: isMac ? '⌘' : 'Ctrl+',
  rail: (n: number) => (isMac ? `⌃${n}` : `Alt+${n}`),
  quickOpen: isMac ? '⌘K' : 'Ctrl+K',
  sidebar: isMac ? '⌘B' : 'Ctrl+B',
  inspector: isMac ? '⌥⌘B' : 'Ctrl+Alt+B',
  closeTab: isMac ? '⌘W or ⌥W' : 'Ctrl+W or Alt+W',
};

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');

/**
 * App-wide keyboard shortcuts. Every panel toggle here is instant: keyboard-driven changes never animate.
 * Browsers keep ⌘W for themselves in a normal tab, so ⌥W is the reliable close-tab key there.
 */
export function useGlobalShortcuts(activePath: string): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const railMod = isMac ? e.ctrlKey && !e.metaKey && !e.altKey : e.altKey && !e.ctrlKey;
      const digit = /^Digit([1-6])$/.exec(e.code);
      if (railMod && digit) {
        e.preventDefault();
        selectRail(RAIL_VIEWS[Number(digit[1]) - 1]!, { keyboard: true });
        return;
      }
      if (mod && !e.shiftKey && (e.code === 'KeyK' || e.code === 'KeyP') && !e.altKey) {
        e.preventDefault();
        openQuickOpen();
        return;
      }
      if (mod && e.code === 'KeyB') {
        e.preventDefault();
        const ui = getUi();
        if (e.altKey) setUi({ inspectorOpen: !ui.inspectorOpen, instantPanels: true });
        else setUi({ sidebarOpen: !ui.sidebarOpen, instantPanels: true });
        return;
      }
      const altClose = e.altKey && !e.metaKey && !e.ctrlKey && !editable(e.target);
      if (e.code === 'KeyW' && ((mod && !e.altKey) || altClose) && activePath) {
        e.preventDefault();
        closeTab(activePath, activePath);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [activePath]);
}
