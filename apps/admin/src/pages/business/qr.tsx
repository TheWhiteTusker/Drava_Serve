import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Copy, Check, Printer, ExternalLink } from 'lucide-react';
import { toast } from '../../ui';

export function QrImage({ url, label, size }: { url: string; label: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { width: size, margin: 2 }).then(setSrc);
  }, [url, size]);
  return (
    <figure style={{ margin: 0, textAlign: 'center' }}>
      {src && (
        <img
          src={src}
          alt={`QR code for ${label}`}
          width={size}
          height={size}
          style={{
            borderRadius: 'var(--brand-radius)',
            border: '1px solid var(--brand-border)',
            boxShadow: 'var(--brand-shadow)',
            padding: '0.75rem',
            background: '#ffffff',
          }}
        />
      )}
      <figcaption style={{ marginTop: '0.75rem' }}>
        <strong style={{ fontSize: '1.05rem', letterSpacing: '-0.01em' }}>{label}</strong>
      </figcaption>
    </figure>
  );
}

// Guests scan this at the table; the menu needs no sign-in and collects nothing about them.
export function MenuQr({ url, label, title }: { url: string; label: string; title: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast('Menu link copied to clipboard');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <section className="card" style={{ textAlign: 'center', maxWidth: 480, margin: '1.5rem auto', padding: '2rem 1.5rem' }}>
      <h2 style={{ marginBottom: '1.25rem' }}>{title}</h2>
      <QrImage url={url} label={label} size={280} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.5rem',
          margin: '1.25rem 0',
          padding: '0.5rem 0.75rem',
          background: 'var(--brand-surface-2)',
          borderRadius: 'var(--brand-radius)',
          border: '1px solid var(--brand-border)',
          fontSize: '0.85rem',
          overflow: 'hidden',
        }}
      >
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--brand-text)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}
        >
          {url} <ExternalLink size={13} className="muted" />
        </a>
      </div>
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
        <button type="button" className="secondary" onClick={copy}>
          {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied' : 'Copy link'}
        </button>
        <button type="button" className="gold" onClick={() => window.print()}>
          <Printer size={16} /> Print QR code
        </button>
      </div>
    </section>
  );
}
