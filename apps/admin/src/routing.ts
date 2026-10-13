import { useLocation, useNavigate, useParams } from 'react-router-dom';

// Every record has its own address: /vendors is the list, /vendors/new adds one and
// /vendors/sample-dairy opens that vendor (/vendors/sample-dairy/items, a part of it).
// A screen mounted at /vendors/* reads the part after its own path here.
export function useRecordPath() {
  const rest = (useParams()['*'] ?? '').replace(/\/+$/, '');
  const { pathname } = useLocation();
  const go = useNavigate();
  const trimmed = pathname.replace(/\/+$/, '');
  const base = rest ? trimmed.slice(0, trimmed.length - rest.length - 1) : trimmed;
  const [slug = null, sub = null] = rest ? rest.split('/') : [];
  return { slug, sub, base, open: (to: string) => go(`${base}/${to}`), close: () => go(base) };
}
