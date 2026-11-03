import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'b2s-theme';

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

/** Swap the theme with transitions off for two frames, so colours flip at once instead of tweening one by one. */
function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  const current = root.dataset.theme ?? 'system';
  if (current === choice) return;
  root.classList.add('no-transitions');
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('no-transitions')));
}

/** Light / dark / system, persisted in localStorage (storage may be blocked, so every access is guarded). */
export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(read);
  useEffect(() => apply(choice), [choice]);
  const set = useCallback((next: ThemeChoice) => {
    setChoice(next);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the choice just won't persist */
    }
  }, []);
  return { choice, set };
}

/** Resolved colour scheme (explicit toggle wins, else the OS preference). */
export function useIsDark(): boolean {
  const compute = () => {
    const explicit = document.documentElement.dataset.theme;
    if (explicit === 'dark') return true;
    if (explicit === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  const [dark, setDark] = useState(compute);
  useEffect(() => {
    const update = () => setDark(compute());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', update);
      mo.disconnect();
    };
  }, []);
  return dark;
}
