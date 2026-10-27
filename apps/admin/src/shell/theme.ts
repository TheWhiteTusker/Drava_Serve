import { Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

// ---------- Theme: dark by default, or a remembered light choice ----------

type ThemeChoice = 'light' | 'dark';
export function useTheme(): [ThemeChoice, () => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => (localStorage.getItem('fnb.theme') === 'light' ? 'light' : 'dark'));
  useEffect(() => {
    if (choice === 'dark') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', choice);
    localStorage.setItem('fnb.theme', choice);
  }, [choice]);
  return [choice, () => setChoice((c) => (c === 'dark' ? 'light' : 'dark'))];
}
export const THEME_ICON = { light: Sun, dark: Moon };
export const THEME_LABEL = { light: 'Theme: light (switch to dark)', dark: 'Theme: dark (switch to light)' };
