import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

// Native <dialog>: focus trapping, Escape to close and a backdrop come with the platform.
export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (open && !d?.open) {
      d?.showModal();
      // Start in the first field, not on the close button.
      setTimeout(() => d?.querySelector<HTMLElement>('.dialog-body input:not([type=checkbox]), .dialog-body select, .dialog-body textarea')?.focus(), 0);
    }
    if (!open && d?.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={wide ? 'wide' : ''} onClose={onClose} aria-labelledby="dialog-title">
      <header className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button type="button" className="ghost icon-only" onClick={onClose} aria-label="Close">
          <X className="icon" />
        </button>
      </header>
      <div className="dialog-body">{open && children}</div>
    </dialog>
  );
}

// A question with a typed answer (used instead of the browser's prompt box).
export function AskDialog({ open, title, label, confirm, onAnswer, onClose }: { open: boolean; title: string; label: string; confirm: string; onAnswer: (v: string) => void; onClose: () => void }) {
  const [v, setV] = useState('');
  return (
    <Modal open={open} title={title} onClose={() => (setV(''), onClose())}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onAnswer(v);
          setV('');
        }}
      >
        <div className="field">
          <label htmlFor="ask">{label}</label>
          <input id="ask" autoFocus required minLength={3} value={v} onChange={(e) => setV(e.target.value)} />
        </div>
        <footer className="row end">
          <button type="button" className="ghost" onClick={() => (setV(''), onClose())}>
            Cancel
          </button>
          <button>{confirm}</button>
        </footer>
      </form>
    </Modal>
  );
}
