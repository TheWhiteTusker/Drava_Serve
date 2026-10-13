import { useSyncExternalStore } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';

// ---------- Toasts: short confirmations instead of pop-ups ----------

type Toast = { id: number; text: string; tone: 'ok' | 'danger' };
let toasts: Toast[] = [];
const toastListeners = new Set<() => void>();
export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const t = { id: Date.now() + Math.random(), text, tone };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l());
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l());
  }, 3800);
}
export function Toasts() {
  const list = useSyncExternalStore(
    (l) => (toastListeners.add(l), () => toastListeners.delete(l)),
    () => toasts,
  );
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.tone === 'danger' ? 'danger' : ''}`}>
          {t.tone === 'danger' ? <AlertCircle className="icon" aria-hidden /> : <CheckCircle2 className="icon" aria-hidden />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
