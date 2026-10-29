import { allWorklets, getModuleType } from '../modules/registry';
import type { Patch, PresetLibrary } from '../patch/types';
import { PatchRuntime } from './PatchRuntime';
import { Scheduler } from './Scheduler';

export type EngineState = 'off' | 'starting' | 'running' | 'suspended' | 'error';

/**
 * Owns the AudioContext. Browsers (iOS Safari above all) only allow audio to
 * start from a user gesture, so nothing is created until `start()` is called
 * from a tap or click.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private runtime: PatchRuntime | null = null;
  private scheduler: Scheduler | null = null;
  private pending: Patch | null = null;
  private library: PresetLibrary = {};
  /** True once the worklets have loaded; until then edits wait in `pending`. */
  private ready = false;
  private worklets: Promise<void> = Promise.resolve();
  private analyser: AnalyserNode | null = null;
  private listeners = new Set<(s: EngineState) => void>();
  state: EngineState = 'off';

  onState(fn: (s: EngineState) => void): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  /** Must be called from inside a user gesture handler. */
  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') return;
    this.setState('starting');
    // Without this, iOS routes Web Audio through the ringer and the mute switch silences it.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';

    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      this.ctx = ctx;
      ctx.onstatechange = () => this.setState(ctx.state === 'running' ? 'running' : 'suspended');
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.1;
      limiter.connect(ctx.destination);
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      limiter.connect(this.analyser);
      this.scheduler = new Scheduler({ now: () => ctx.currentTime });
      this.runtime = new PatchRuntime({ ctx, scheduler: this.scheduler, master: limiter }, getModuleType);
      unlockWithSilentBuffer(ctx);
      // Resume inside the gesture first; iOS only honours it synchronously.
      const resumed = ctx.resume();
      this.worklets = Promise.all(allWorklets().map((url) => ctx.audioWorklet.addModule(url))).then(() => undefined);
      await resumed;
    }
    await this.ctx.resume();
    try {
      await this.worklets;
    } catch (e) {
      console.error('Could not load audio worklets', e);
      this.setState('error');
      return;
    }
    this.scheduler!.start();
    this.ready = true;
    this.runtime!.setLibrary(this.library);
    if (this.pending) this.runtime!.sync(this.pending);
    this.setState(this.ctx.state === 'running' ? 'running' : 'suspended');
  }

  async suspend(): Promise<void> {
    this.scheduler?.stop();
    await this.ctx?.suspend();
  }

  /** Apply the latest patch. Safe to call before audio has started. */
  sync(patch: Patch, library: PresetLibrary = {}): void {
    this.pending = patch;
    this.library = library;
    if (!this.ready) return;
    this.runtime?.setLibrary(library);
    this.runtime?.sync(patch);
  }

  /** Current RMS level of the master output, 0..1. */
  level(): number {
    if (!this.analyser) return 0;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    return Math.sqrt(buf.reduce((sum, x) => sum + x * x, 0) / buf.length);
  }

  /** Live UI state of a module, or undefined when audio isn't running. */
  moduleState(moduleId: string): unknown {
    if (!this.ctx || !this.runtime) return undefined;
    return this.runtime.getState(moduleId, this.ctx.currentTime);
  }

  private setState(s: EngineState): void {
    this.state = s;
    for (const l of this.listeners) l(s);
  }
}

/** Older iOS versions only unlock audio once a buffer actually plays inside the gesture. */
function unlockWithSilentBuffer(ctx: AudioContext): void {
  const src = ctx.createBufferSource();
  src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
  src.connect(ctx.destination);
  src.start();
}
