import { useState } from 'react';
import { api } from '../../api';
import { ErrorNote } from '../../ui';

export function Placement({ item, onDone }: { item: any; onDone: () => void }) {
  const [pin, setPin] = useState(item.pinPosition ? String(item.pinPosition) : '');
  const [excluded, setExcluded] = useState(!!item.offerExcluded);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className="field">
        <label htmlFor="pin">Pin at position (blank = ranked by margin)</label>
        <input id="pin" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
      </div>
      {item.department === 'beverage' && (
        <label className="check">
          <input type="checkbox" checked={excluded} onChange={(e) => setExcluded(e.target.checked)} /> Never put this beverage on offer
        </label>
      )}
      <ErrorNote error={error} />
      <footer className="row end">
        <button
          onClick={() =>
            api(`/menu-items/${item.id}/placement`, { method: 'PUT', body: { pinPosition: pin ? Number(pin) : null, offerExcluded: excluded } })
              .then(onDone)
              .catch((e) => setError(e.message))
          }
        >
          Save
        </button>
      </footer>
    </>
  );
}
