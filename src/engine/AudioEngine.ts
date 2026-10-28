import { getModuleType } from '../modules/registry';
import type { Patch } from '../patch/types';
import { PatchRuntime } from './PatchRuntime';
import { Scheduler } from './Scheduler';

export type EngineState = 'off' | 'starting' | 'running' | 'suspended';

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
      this.scheduler = new Scheduler({ now: () => ctx.currentTime });
      this.runtime = new PatchRuntime({ ctx, scheduler: this.scheduler, master: limiter }, getModuleType);
      unlockWithSilentBuffer(ctx);
    }
    await this.ctx.resume();
    this.scheduler!.start();
    if (this.pending) this.runtime!.sync(this.pending);
    this.setState(this.ctx.state === 'running' ? 'running' : 'suspended');
  }

  async suspend(): Promise<void> {
    this.scheduler?.stop();
    await this.ctx?.suspend();
  }

  /** Apply the latest patch. Safe to call before audio has started. */
  sync(patch: Patch): void {
    this.pending = patch;
    this.runtime?.sync(patch);
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
