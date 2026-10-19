import QRCode from 'qrcode';

/** PNG data URL of the pairing line. The phone scans this; the relay never sees it. */
export function pairingQrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 280,
    color: { dark: '#111111', light: '#ffffff' },
  });
}
