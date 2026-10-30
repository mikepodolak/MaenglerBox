import { describe, expect, it } from 'vitest';
import { WavWriter, wavHeader } from '../src/dsp/wav';
import { channelOn } from '../src/modules/mixing';
import { getDef } from '../src/modules/registry';
import { asCopy, exportPatch, mergeLibrary, parsePatchFile } from '../src/patch/exchange';
import { addModule, createPatch } from '../src/patch/model';

describe('WAV recording', () => {
  it('writes a 24-bit stereo header', () => {
    const v = new DataView(wavHeader(48000, 10).buffer);
    const tag = (at: number) => String.fromCharCode(...new Uint8Array(v.buffer, at, 4));
    expect(tag(0)).toBe('RIFF');
    expect(tag(8)).toBe('WAVE');
    expect(v.getUint16(22, true)).toBe(2);
    expect(v.getUint32(24, true)).toBe(48000);
    expect(v.getUint16(34, true)).toBe(24);
    expect(v.getUint32(40, true)).toBe(60);
  });

  it('stores samples little-endian and clips', async () => {
    const w = new WavWriter(44100);
    w.push(new Float32Array([1, -2]), new Float32Array([0, 0.5]));
    expect(w.seconds).toBeCloseTo(2 / 44100);
    const bytes = new Uint8Array(await w.blob().arrayBuffer());
    expect(bytes.length).toBe(44 + 12);
    const s = (i: number) => {
      const o = 44 + i * 3;
      return ((bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16)) << 8) >> 8;
    };
    expect([s(0), s(1), s(2), s(3)]).toEqual([8388607, 0, -8388607, Math.round(0.5 * 8388607)]);
  });
});

describe('mixer solo', () => {
  it('solo silences the others and beats mute', () => {
    const p: Record<string, number> = { mute2: 1 };
    expect([1, 2, 3].map((n) => channelOn(p, n))).toEqual([true, false, true]);
    p.solo2 = 1;
    expect([1, 2, 3].map((n) => channelOn(p, n))).toEqual([false, true, false]);
    p.solo3 = 1;
    expect([1, 2, 3].map((n) => channelOn(p, n))).toEqual([false, true, true]);
  });
});

describe('sharing patches', () => {
  const preset = { name: 'kick', params: { algorithm: 2 } };
  function setup() {
    const [patch] = addModule(createPatch('Song'), getDef('fm')!);
    const library = { fm: [preset, null], lead: [preset] };
    return { patch, library };
  }

  it('exports the patch and only the presets its synths use, and reads it back', () => {
    const { patch, library } = setup();
    const file = JSON.parse(JSON.stringify(exportPatch(patch, library, getDef)));
    expect(Object.keys(file.library)).toEqual(['fm']);
    const back = parsePatchFile(file, getDef);
    expect(back.patch.id).toBe(patch.id);
    expect(back.patch.modules[0].type).toBe('fm');
    expect(back.library.fm[0]?.name).toBe('kick');
  });

  it('rejects other files, and accepts a bare patch', () => {
    expect(() => parsePatchFile({ hello: 1 }, getDef)).toThrow();
    expect(() => parsePatchFile('x', getDef)).toThrow();
    const { patch } = setup();
    expect(parsePatchFile(JSON.parse(JSON.stringify(patch)), getDef).patch.name).toBe('Song');
  });

  it('fills empty preset slots and keeps the device’s own', () => {
    const mine = { fm: [{ name: 'snare', params: {} }] };
    const r = mergeLibrary(mine, { fm: [preset, preset], pluck: [preset] });
    expect(r.library.fm[0]?.name).toBe('snare');
    expect(r.library.fm[1]?.name).toBe('kick');
    expect(r.library.pluck[0]?.name).toBe('kick');
    expect(r).toMatchObject({ added: 2, skipped: 1 });
    expect(mergeLibrary(r.library, { fm: [null, preset] })).toMatchObject({ added: 0, skipped: 0, changed: [] });
  });

  it('makes a separate copy when asked', () => {
    const { patch } = setup();
    const c = asCopy(patch);
    expect(c.id).not.toBe(patch.id);
    expect(c.name).toBe('Song (copy)');
  });
});

describe('example patches', () => {
  it('build, and survive saving and loading intact', async () => {
    const { EXAMPLES } = await import('../src/modules/examples');
    const { deserializePatch } = await import('../src/patch/model');
    for (const ex of EXAMPLES) {
      const p = ex.build();
      expect(p.modules.length).toBeGreaterThan(10);
      const back = deserializePatch(JSON.parse(JSON.stringify(p)), getDef);
      expect(back.modules.length).toBe(p.modules.length);
      expect(back.cables.length).toBe(p.cables.length);
      if (process.env.EXPORT_EXAMPLES) {
        const fs = await import('node:fs');
        fs.writeFileSync(`${process.env.EXPORT_EXAMPLES}/${ex.name}.maengler.json`, JSON.stringify(exportPatch(p, {}, getDef), null, 1));
      }
    }
  });
});
