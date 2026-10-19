import { describe, expect, it } from 'vitest';
import { pairingQrDataUrl } from './pairing-qr';

describe('pairingQrDataUrl', () => {
  it('encodes a pairing line as a PNG', async () => {
    const line = `sb1.AB234C.${'a'.repeat(43)}.${'b'.repeat(43)}`;
    const url = await pairingQrDataUrl(line);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    expect(url.length).toBeGreaterThan(100);
  });
});
