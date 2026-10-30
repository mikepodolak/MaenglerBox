import { describe, expect, it } from 'vitest';
import { getDef } from '../src/modules/registry';
import { addModule, connect, createPatch, deserializePatch, disconnect, PatchError, removeModule, setModuleData, setParam } from '../src/patch/model';
import { defaultPatch } from '../src/patch/defaultPatch';

const def = (t: string) => getDef(t)!;

describe('patch model', () => {
  it('adds modules with default params', () => {
    const [p, m] = addModule(createPatch(), def('oscillator'));
    expect(p.modules).toHaveLength(1);
    expect(m.params.freq).toBe(220);
  });

  it('connects any output to any input, including gate to audio', () => {
    let p = createPatch();
    let clock, osc, amp;
    [p, clock] = addModule(p, def('clock'));
    [p, osc] = addModule(p, def('oscillator'));
    [p, amp] = addModule(p, def('vca'));
    [p] = connect(p, getDef, { module: osc.id, port: 'out' }, { module: amp.id, port: 'cv' });
    expect(p.cables).toHaveLength(1);
    [p] = connect(p, getDef, { module: clock.id, port: 'out' }, { module: amp.id, port: 'in' });
    expect(p.cables).toHaveLength(2);
  });

  it('does not duplicate an identical cable', () => {
    let p = createPatch();
    let osc, amp;
    [p, osc] = addModule(p, def('oscillator'));
    [p, amp] = addModule(p, def('vca'));
    const from = { module: osc.id, port: 'out' };
    const to = { module: amp.id, port: 'in' };
    [p] = connect(p, getDef, from, to);
    const [p2] = connect(p, getDef, from, to);
    expect(p2.cables).toHaveLength(1);
  });

  it('rejects unknown ports', () => {
    let p = createPatch();
    let osc, amp;
    [p, osc] = addModule(p, def('oscillator'));
    [p, amp] = addModule(p, def('vca'));
    expect(() => connect(p, getDef, { module: osc.id, port: 'nope' }, { module: amp.id, port: 'in' })).toThrow(PatchError);
  });

  it('removing a module removes its cables', () => {
    const p = defaultPatch(getDef);
    const amp = p.modules.find((m) => m.type === 'fm')!;
    const after = removeModule(p, amp.id);
    expect(after.cables.every((c) => c.from.module !== amp.id && c.to.module !== amp.id)).toBe(true);
    expect(after.cables).toHaveLength(1);
  });

  it('disconnects by cable id', () => {
    const p = defaultPatch(getDef);
    expect(disconnect(p, p.cables[0].id).cables).toHaveLength(p.cables.length - 1);
  });

  it('clamps params to range', () => {
    let [p, osc] = addModule(createPatch(), def('oscillator'));
    p = setParam(p, getDef, osc.id, 'freq', 1e9);
    expect(p.modules[0].params.freq).toBe(8000);
  });

  it('does not mutate the previous patch', () => {
    const [p, osc] = addModule(createPatch(), def('oscillator'));
    setParam(p, getDef, osc.id, 'freq', 300);
    expect(p.modules[0].params.freq).toBe(220);
  });
});

describe('deserializePatch', () => {
  it('round-trips through JSON', () => {
    const p = defaultPatch(getDef);
    const back = deserializePatch(JSON.parse(JSON.stringify(p)), getDef);
    expect(back.modules).toEqual(p.modules);
    expect(back.cables.map((c) => [c.from, c.to])).toEqual(p.cables.map((c) => [c.from, c.to]));
  });

  it('drops unknown modules and their dangling cables, fills and clamps params', () => {
    const raw = {
      version: 1,
      id: 'x',
      name: 'Broken',
      modules: [
        { id: 'a', type: 'oscillator', x: 1, y: 2, params: { freq: -5 } },
        { id: 'b', type: 'from-the-future', x: 0, y: 0, params: {} },
      ],
      cables: [{ id: 'c', from: { module: 'a', port: 'out' }, to: { module: 'b', port: 'in' } }],
    };
    const p = deserializePatch(raw, getDef);
    expect(p.modules.map((m) => m.id)).toEqual(['a']);
    expect(p.modules[0].params).toEqual({ freq: 20, wave: 0, fmDepth: 0, morph: 0 });
    expect(p.cables).toEqual([]);
  });

  it('rejects things that are not patches', () => {
    expect(() => deserializePatch({ hello: 1 }, getDef)).toThrow(PatchError);
    expect(() => deserializePatch(null, getDef)).toThrow(PatchError);
  });
});

describe('module data', () => {
  it('creates sequencer steps on add and validates them on set', () => {
    let [p, seq] = addModule(createPatch(), def('sequencer'));
    const data = seq.data as { steps: { note: number; chance: number }[] };
    expect(data.steps).toHaveLength(32);
    const steps = data.steps.map((s, i) => (i === 0 ? { ...s, note: 999, chance: -1 } : s));
    p = setModuleData(p, getDef, seq.id, { steps });
    const saved = p.modules[0].data as typeof data;
    expect(saved.steps[0].note).toBe(127);
    expect(saved.steps[0].chance).toBe(0);
  });

  it('repairs missing or corrupt sequencer data when loading', () => {
    const p = deserializePatch(
      { version: 1, modules: [{ id: 's', type: 'sequencer', params: {}, data: { steps: [null, { on: 'yes', note: 61 }] } }], cables: [] },
      getDef,
    );
    const steps = (p.modules[0].data as { steps: { on: boolean; note: number }[] }).steps;
    expect(steps).toHaveLength(32);
    expect(steps[1].note).toBe(61);
    expect(typeof steps[1].on).toBe('boolean');
  });
});
