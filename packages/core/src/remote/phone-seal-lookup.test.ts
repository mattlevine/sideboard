import { describe, expect, it } from 'vitest';
import { lookupSealMaterial } from '../../../../apps/mobile/phone-seal-lookup.ts';

const work = {
  deviceId: 'mac-work',
  sessionToken: 'tok-work',
  hostPublicKey: 'work-pk',
  phoneToken: 'work-pt',
};
const home = {
  deviceId: 'mac-home',
  sessionToken: 'tok-home',
  hostPublicKey: 'home-pk',
  phoneToken: 'home-pt',
};

describe('lookupSealMaterial', () => {
  it('uses the Mac being resumed, not the previously open one', () => {
    expect(lookupSealMaterial(null, [work, home], 'mac-work', 'tok-home')).toEqual({
      hostPublicKey: 'home-pk',
      phoneToken: 'home-pt',
    });
  });

  it('uses the paired Mac even when another desktop is still selected', () => {
    expect(
      lookupSealMaterial(null, [work, home], 'mac-work', 'tok-work', {
        deviceId: 'mac-home',
        sessionToken: 'tok-home',
      }),
    ).toEqual({
      hostPublicKey: 'home-pk',
      phoneToken: 'home-pt',
    });
  });

  it('keeps the pairing-line pin for a new Mac', () => {
    expect(
      lookupSealMaterial({ hostPublicKey: 'new-pk', phoneToken: 'new-pt' }, [work, home], 'mac-work', null),
    ).toEqual({
      hostPublicKey: 'new-pk',
      phoneToken: 'new-pt',
    });
  });
});
