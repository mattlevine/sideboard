import { useEffect, useState } from 'react';
import { pairingQrDataUrl } from '../lib/pairing-qr';

export function PairingQr({ value }: { value: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    void pairingQrDataUrl(value)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  if (!src) return null;
  return <img className="pairing-qr" src={src} alt="Pairing QR code" width={220} height={220} />;
}
