import QRCode from 'qrcode';
import { useEffect, useState } from 'react';

export function QrImage({ url, label, size }: { url: string; label: string; size: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toDataURL(url, { width: size, margin: 2 }).then(setSrc);
  }, [url, size]);
  return (
    <figure style={{ margin: 0, textAlign: 'center' }}>
      {src && <img src={src} alt={`QR code for ${label}`} width={size} height={size} />}
      <figcaption>
        <strong>{label}</strong>
      </figcaption>
    </figure>
  );
}

// Guests scan this at the table; the menu needs no sign-in and collects nothing about them.
export function MenuQr({ url, label, title }: { url: string; label: string; title: string }) {
  return (
    <section className="card" style={{ textAlign: 'center' }}>
      <h2>{title}</h2>
      <QrImage url={url} label={label} size={320} />
      <p>
        <a href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
      </p>
      <button onClick={() => window.print()}>Print</button>
    </section>
  );
}
