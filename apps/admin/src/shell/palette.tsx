import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { NavItem } from './nav';

// Jump anywhere: Ctrl+K (⌘K on a Mac), type a few letters, Enter.
export function CommandPalette({ open, onClose, nav }: { open: boolean; onClose: () => void; nav: NavItem[] }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const go = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return nav.filter((n) => words.every((w) => `${n.label} ${n.group} ${n.keywords ?? ''}`.toLowerCase().includes(w)));
  }, [q, nav]);
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) d?.showModal();
    if (!open && d?.open) d.close();
    setQ('');
    setI(0);
  }, [open]);
  const pick = (n: NavItem) => {
    go(n.to);
    onClose();
  };
  return (
    <dialog ref={ref} className="palette" onClose={onClose} aria-label="Go to">
      <input
        autoFocus
        placeholder="Where to? Try “stock”, “offers” or “vendors”"
        value={q}
        onChange={(e) => (setQ(e.target.value), setI(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setI((x) => Math.min(x + 1, hits.length - 1));
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setI((x) => Math.max(x - 1, 0));
          }
          if (e.key === 'Enter' && hits[i]) pick(hits[i]);
        }}
      />
      <ul role="listbox">
        {hits.map((n, j) => (
          <li key={n.to}>
            <button role="option" aria-selected={j === i} onMouseEnter={() => setI(j)} onClick={() => pick(n)}>
              <n.icon className="icon" aria-hidden /> {n.label}
              <span className="muted">{n.group}</span>
            </button>
          </li>
        ))}
        {!hits.length && <li className="muted" style={{ padding: '1rem' }}>Nothing found.</li>}
      </ul>
    </dialog>
  );
}
