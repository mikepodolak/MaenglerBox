import { GateOutput } from '../engine/gate';
import type { ModuleDataDef, PortDef } from '../patch/types';
import { sequencer, SequencerCore, sequencerData, type SequencerData, type SequencerSettings } from './sequencer';
import type { ModuleType } from './types';

export const TRACKS = 8;

export interface MultiTrackerData {
  /** One step pattern per track, each like a Chance Sequencer's. */
  tracks: SequencerData[];
  /** Muted tracks keep their place in time but send no notes. */
  mutes: boolean[];
}

/** A quiet default: a four-on-the-floor on track 1, the rest empty, so it's obvious what each track does. */
function emptyTrack(t: number): SequencerData {
  const d = sequencerData.create();
  d.steps = d.steps.map((s, i) => ({ ...s, on: t === 0 && i % 4 === 0, chance: 1, note: 48 }));
  return d;
}

export const multiTrackerData: ModuleDataDef<MultiTrackerData> = {
  create: () => ({ tracks: Array.from({ length: TRACKS }, (_, t) => emptyTrack(t)), mutes: Array(TRACKS).fill(false) }),
  normalize(raw) {
    const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<MultiTrackerData>;
    const tracks = Array.isArray(r.tracks) ? r.tracks : [];
    const mutes = Array.isArray(r.mutes) ? r.mutes : [];
    return {
      tracks: Array.from({ length: TRACKS }, (_, t) => (tracks[t] ? sequencerData.normalize(tracks[t]) : emptyTrack(t))),
      mutes: Array.from({ length: TRACKS }, (_, t) => mutes[t] === true),
    };
  },
};

/** Output port id for a track (0-based). */
export const trackPort = (t: number) => `out${t + 1}`;

/**
 * M8-style multi-track tracker: eight step tracks on one clock, each with its
 * own Notes output to patch to its own voice. Every track has the Chance
 * Sequencer's per-step chance, ratchets, conditions, presets and locks.
 */
export const multiTracker: ModuleType = {
  def: {
    type: 'tracker',
    label: 'Tracker',
    description: 'Eight step tracks on one clock, M8 style. Each track has its own Notes output.',
    inputs: [
      { id: 'clock', label: 'Clock', kind: 'gate' },
      { id: 'reset', label: 'Reset', kind: 'gate' },
    ],
    outputs: Array.from({ length: TRACKS }, (_, t): PortDef => ({ id: trackPort(t), label: `Track ${t + 1}`, kind: 'gate' })),
    // Same settings as the Chance Sequencer, shared by every track.
    params: sequencer.def.params.map((p) => (p.id === 'scale' ? { ...p, default: 0 } : p)),
    face: [],
    data: multiTrackerData as ModuleDataDef,
    presetScope: 'patch',
  },
  create(_env, params, data) {
    const settings = { ...(params as unknown as SequencerSettings) };
    let d = multiTrackerData.normalize(data);
    const outs = Array.from({ length: TRACKS }, () => new GateOutput());
    // Every core shares one settings object, so a param change reaches all tracks.
    const cores = d.tracks.map((t) => new SequencerCore(t, settings));
    return {
      inputs: {
        clock: {
          kind: 'gate',
          handler: (e) =>
            cores.forEach((core, t) => {
              const events = core.clock(e.time, e.length);
              if (!d.mutes[t]) events.forEach((ev) => outs[t].emit(ev));
            }),
        },
        reset: { kind: 'gate', handler: () => cores.forEach((c) => c.reset()) },
      },
      outputs: Object.fromEntries(outs.map((out, t) => [trackPort(t), { kind: 'gate' as const, out }])),
      setParam(id, v) {
        (settings as unknown as Record<string, number>)[id] = v;
      },
      setData(next) {
        d = multiTrackerData.normalize(next);
        cores.forEach((c, t) => (c.data = d.tracks[t]));
      },
      getState: (now) => ({ step: cores[0].stepAt(now) }),
      dispose() {},
    };
  },
};
