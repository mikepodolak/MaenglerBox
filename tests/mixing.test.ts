import { describe, expect, it } from 'vitest';
import { HELP } from '../src/modules/help';
import { MIXER_CHANNELS, RESPONSE_FREQS, toDb } from '../src/modules/mixing';
import { getDef } from '../src/modules/registry';

describe('mixing and monitoring', () => {
  it('converts levels to dB with a floor for silence', () => {
    expect(toDb(1)).toBeCloseTo(0);
    expect(toDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(toDb(0)).toBe(-96);
  });

  it('draws responses across the audible range', () => {
    expect(RESPONSE_FREQS[0]).toBeCloseTo(20);
    expect(RESPONSE_FREQS[RESPONSE_FREQS.length - 1]).toBeCloseTo(20000, -1);
  });

  it('every new module is registered, helped, and its face and groups name real settings', () => {
    for (const type of ['meter', 'light', 'mixer', 'filter', 'eq']) {
      const def = getDef(type)!;
      expect(def, type).toBeDefined();
      expect(HELP[type], type).toBeDefined();
      const ids = new Set(def.params.map((p) => p.id));
      for (const id of [...(def.face ?? []), ...(def.groups ?? []).flatMap((g) => g.params)]) expect(ids.has(id), `${type}.${id}`).toBe(true);
    }
    expect(getDef('mixer')!.inputs).toHaveLength(MIXER_CHANNELS);
  });
});
