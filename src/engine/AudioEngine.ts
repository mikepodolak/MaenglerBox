import { allWorklets, getModuleType } from '../modules/registry';
import type { Patch, PresetLibrary } from '../patch/types';
import { CONVERT_WORKLETS } from './convert';
import { MOD_RATE_HZ } from './modulation';
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
  private master: AudioNode | null = null;
  private recorder: MediaRecorder | null = null;
  private recordStart = 0;
  private modTimer: ReturnType<typeof setInterval> | null = null;
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
      this.master = limiter;
      this.scheduler = new Scheduler({ now: () => ctx.currentTime });
      this.runtime = new PatchRuntime({ ctx, scheduler: this.scheduler, master: limiter }, getModuleType);
      unlockWithSilentBuffer(ctx);
      // Resume inside the gesture first; iOS only honours it synchronously.
      const resumed = ctx.resume();
      this.worklets = Promise.all([...allWorklets(), ...CONVERT_WORKLETS].map((url) => ctx.audioWorklet.addModule(url))).then(() => undefined);
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
    // Cables into settings are applied on a timer of their own, so they keep moving when the screen isn't redrawing.
    this.modTimer ??= setInterval(() => this.runtime?.modulate(), 1000 / MOD_RATE_HZ);
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

  get recording(): boolean {
    return this.recorder?.state === 'recording';
  }

  /** Seconds since recording started, or 0. */
  recordedSeconds(): number {
    return this.recording && this.ctx ? this.ctx.currentTime - this.recordStart : 0;
  }

  /** Start recording what comes out of the speakers. Needs audio running. */
  startRecording(): boolean {
    if (!this.ctx || !this.master || this.recording || typeof MediaRecorder === 'undefined') return false;
    const dest = this.ctx.createMediaStreamDestination();
    this.master.connect(dest);
    // Safari records AAC in MP4; Chrome and Firefox record Opus in WebM.
    const mimeType = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(dest.stream, mimeType ? { mimeType, audioBitsPerSecond: 256000 } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      this.master?.disconnect(dest);
      this.lastRecording = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
      this.recordingDone?.(this.lastRecording);
    };
    rec.start(1000);
    this.recorder = rec;
    this.recordStart = this.ctx.currentTime;
    return true;
  }

  lastRecording: Blob | null = null;
  private recordingDone: ((b: Blob) => void) | null = null;

  /** Stop recording and get the audio file. */
  stopRecording(): Promise<Blob | null> {
    const rec = this.recorder;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    return new Promise((resolve) => {
      this.recordingDone = (b) => {
        this.recordingDone = null;
        this.recorder = null;
        resolve(b);
      };
      rec.stop();
    });
  }

  /** Current RMS level of the master output, 0..1. */
  level(): number {
    if (!this.analyser) return 0;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    return Math.sqrt(buf.reduce((sum, x) => sum + x * x, 0) / buf.length);
  }

  /** Live UI state of a module, or undefined when audio isn't running. */
  /** Settings that cables are moving right now, and their current values. */
  modValues(moduleId: string): ReadonlyMap<string, number> | undefined {
    return this.runtime?.modValues(moduleId);
  }

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
