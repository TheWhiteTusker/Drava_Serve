import { Laptop, Moon, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';

// ---------- Theme: follows the device, or a remembered light / dark choice ----------

type ThemeChoice = 'system' | 'light' | 'dark';
export function useTheme(): [ThemeChoice, () => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => (localStorage.getItem('fnb.theme') as ThemeChoice) ?? 'system');
  useEffect(() => {
    if (choice === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', choice);
    localStorage.setItem('fnb.theme', choice);
  }, [choice]);
  const next = { system: 'light', light: 'dark', dark: 'system' } as const;
  return [choice, () => setChoice((c) => next[c])];
}
export const THEME_ICON = { system: Laptop, light: Sun, dark: Moon };
export const THEME_LABEL = { system: 'Theme: follows this device', light: 'Theme: light', dark: 'Theme: dark' };
