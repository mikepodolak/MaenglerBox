/**
 * Lookahead scheduler ("A Tale of Two Clocks" pattern).
 *
 * A JS timer wakes up every `intervalMs` and asks each listener to schedule
 * whatever falls inside [from, to) on the AudioContext clock. Events are
 * stamped with exact audio times, so timing stays tight even when the main
 * thread is busy (touch handling, redraws).
 */
export type ScheduleWindow = (from: number, to: number) => void;

export interface SchedulerOptions {
  now: () => number;
  lookahead?: number;
  intervalMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class Scheduler {
  private listeners = new Set<ScheduleWindow>();
  private handle: unknown = null;
  private scheduledUntil = 0;
  private readonly lookahead: number;
  private readonly intervalMs: number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly opts: SchedulerOptions) {
    this.lookahead = opts.lookahead ?? 0.12;
    this.intervalMs = opts.intervalMs ?? 25;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setInterval(fn, ms));
    this.clearTimer = opts.clearTimer ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  }

  get running(): boolean {
    return this.handle !== null;
  }

  add(listener: ScheduleWindow): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.running) return;
    this.scheduledUntil = this.opts.now();
    this.handle = this.setTimer(() => this.tick(), this.intervalMs);
    this.tick();
  }

  stop(): void {
    if (this.handle !== null) this.clearTimer(this.handle);
    this.handle = null;
  }

  /** Schedule everything up to now + lookahead. Exposed for tests. */
  tick(): void {
    const now = this.opts.now();
    // If the timer stalled (tab backgrounded), skip ahead instead of firing a burst of late events.
    const from = Math.max(this.scheduledUntil, now);
    const to = now + this.lookahead;
    if (to <= from) return;
    for (const l of this.listeners) l(from, to);
    this.scheduledUntil = to;
  }
}
