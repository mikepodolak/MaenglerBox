import { GateOutput } from '../engine/gate';
import { cvSource, PITCH_PARAMS, unitToNote } from './util';
import type { ModuleType } from './types';

export const MAX_BALLS = 8;
/** Physics step, seconds. Small enough that fast balls don't tunnel through each other. */
export const SIM_DT = 1 / 240;
const MAX_SPEED = 4;
/** Impacts slower than this are a ball resting on the floor, not a hit. */
const MIN_HIT_SPEED = 0.15;

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export type HitKind = 'floor' | 'wall' | 'ball';

export interface Hit {
  kind: HitKind;
  /** Seconds into the step at which it happened (the end of the step). */
  ball: number;
  x: number;
  y: number;
  /** Impact speed, 0..1 of the maximum. */
  speed: number;
}

export interface SimSettings {
  count: number;
  /** 0..2, about one screen height per second squared at 1. */
  gravity: number;
  /** Fraction of speed kept on each bounce; above 1 adds energy. */
  bounce: number;
  /** Ball radius as a fraction of the box. */
  size: number;
}

/**
 * Balls in a unit box (y grows downward). Walls, floor and ceiling bounce;
 * balls collide with each other elastically. Pure and deterministic given a
 * random source, so it can run ahead of the audio clock and be tested.
 */
export class BallSim {
  balls: Ball[] = [];

  constructor(
    public settings: SimSettings,
    private readonly random: () => number = Math.random,
  ) {
    this.fit();
  }

  /** Add or drop balls to match the count, keeping the ones already moving. */
  fit(): void {
    const n = Math.max(1, Math.min(MAX_BALLS, Math.round(this.settings.count)));
    while (this.balls.length < n) this.balls.push(this.spawn(this.balls.length));
    this.balls.length = n;
  }

  /** Throw every ball back in from a fresh spot. */
  reset(): void {
    this.balls = [];
    this.fit();
  }

  /** Throw every ball upward with a random push, to wake a settled box. */
  kick(strength = 1): void {
    for (const b of this.balls) {
      b.vx += (this.random() * 2 - 1) * 0.8 * strength;
      b.vy -= (0.8 + this.random() * 1.2) * strength;
    }
  }

  private spawn(i: number): Ball {
    // Spread drop heights so the balls fall out of step and make a polyrhythm.
    return {
      x: 0.15 + this.random() * 0.7,
      y: 0.1 + ((i * 0.37 + this.random() * 0.3) % 0.6),
      vx: (this.random() * 2 - 1) * 0.4,
      vy: 0,
    };
  }

  /** Advance by `dt` seconds and return what hit what. */
  step(dt: number): Hit[] {
    const { gravity, bounce, size } = this.settings;
    const r = size;
    const g = gravity * 2.5;
    const hits: Hit[] = [];
    const hit = (kind: HitKind, ball: number, speed: number) => {
      if (speed < MIN_HIT_SPEED) return;
      const b = this.balls[ball];
      hits.push({ kind, ball, x: b.x, y: b.y, speed: Math.min(1, speed / MAX_SPEED) });
    };
    this.balls.forEach((b, i) => {
      b.vy += g * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y > 1 - r && b.vy > 0) {
        hit('floor', i, b.vy);
        b.y = 1 - r;
        b.vy = -b.vy * bounce;
      } else if (b.y < r && b.vy < 0) {
        hit('wall', i, -b.vy);
        b.y = r;
        b.vy = -b.vy * bounce;
      }
      if (b.x < r && b.vx < 0) {
        hit('wall', i, -b.vx);
        b.x = r;
        b.vx = -b.vx * bounce;
      } else if (b.x > 1 - r && b.vx > 0) {
        hit('wall', i, b.vx);
        b.x = 1 - r;
        b.vx = -b.vx * bounce;
      }
    });
    for (let i = 0; i < this.balls.length; i++) {
      for (let j = i + 1; j < this.balls.length; j++) {
        const a = this.balls[i];
        const b = this.balls[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= 2 * r || dist === 0) continue;
        const nx = dx / dist;
        const ny = dy / dist;
        const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        // Push apart so they don't stick together.
        const overlap = (2 * r - dist) / 2;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        if (closing <= 0) continue;
        // Equal masses: swap the velocity along the line between centres.
        a.vx -= closing * nx;
        a.vy -= closing * ny;
        b.vx += closing * nx;
        b.vy += closing * ny;
        hit('ball', i, closing);
      }
    }
    for (const b of this.balls) {
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > MAX_SPEED) {
        b.vx *= MAX_SPEED / sp;
        b.vy *= MAX_SPEED / sp;
      }
    }
    return hits;
  }
}

interface Frame {
  time: number;
  balls: { x: number; y: number }[];
  flash: HitKind | '';
}

/**
 * Bouncing balls under gravity. Every bounce is an event: floor hits play
 * notes picked by where the ball landed, wall and ball-to-ball hits fire their
 * own gates, and ball 1's position comes out as X and Y CV.
 */
export const balls: ModuleType = {
  def: {
    type: 'balls',
    label: 'Bouncing Balls',
    category: 'Generative',
    description: 'Balls fall and bounce. Floor hits play notes from where they land; wall and ball collisions fire gates; ball 1 sends its X/Y as CV.',
    inputs: [
      { id: 'kick', label: 'Kick', kind: 'gate' },
      { id: 'reset', label: 'Reset', kind: 'gate' },
    ],
    outputs: [
      { id: 'floor', label: 'Floor', kind: 'gate' },
      { id: 'wall', label: 'Wall', kind: 'gate' },
      { id: 'hit', label: 'Ball hit', kind: 'gate' },
      { id: 'x', label: 'X', kind: 'cv' },
      { id: 'y', label: 'Y', kind: 'cv' },
    ],
    params: [
      { id: 'count', label: 'Balls', min: 1, max: MAX_BALLS, default: 3, step: 1 },
      { id: 'gravity', label: 'Gravity', min: 0, max: 2, default: 1, step: 0.01 },
      { id: 'bounce', label: 'Bounce', min: 0.5, max: 1.05, default: 1, step: 0.005 },
      { id: 'speed', label: 'Speed', min: 0.25, max: 3, default: 1, step: 0.01, curve: 'exp' },
      { id: 'size', label: 'Size', min: 0.02, max: 0.15, default: 0.05, step: 0.005 },
      { id: 'range', label: 'Range', min: 0.5, max: 3, default: 2, step: 0.5, unit: 'oct' },
      ...PITCH_PARAMS,
    ],
    face: ['gravity', 'bounce'],
    groups: [
      { label: 'Physics', params: ['count', 'gravity', 'bounce', 'speed', 'size'] },
      { label: 'Notes', params: ['range', 'scale', 'root', 'octave'] },
    ],
    presetScope: 'patch',
    presets: true,
  },
  create({ ctx, scheduler }, params) {
    const p = { ...params };
    const sim = new BallSim(p as unknown as SimSettings);
    const outs = { floor: new GateOutput(), wall: new GateOutput(), hit: new GateOutput() };
    const x = cvSource(ctx);
    const y = cvSource(ctx);
    let simTime = ctx.currentTime;
    let lastFrame = -1;
    let flash: HitKind | '' = '';
    const frames: Frame[] = [];
    const remove = scheduler.add((from, to) => {
      // Skip ahead after a stall (tab in the background) rather than replaying it.
      if (simTime < from - 0.25) simTime = from;
      while (simTime < to) {
        simTime += SIM_DT;
        for (const h of sim.step(SIM_DT * p.speed)) {
          const note = h.kind === 'wall' ? unitToNote(1 - h.y, p.range, p) : unitToNote(h.x, p.range, p);
          outs[h.kind === 'ball' ? 'hit' : h.kind].emit({ time: simTime, value: 0.35 + 0.65 * h.speed, length: 0.08, note });
          flash = h.kind;
        }
        // About 60 frames a second for the face and the CV outputs.
        if (simTime - lastFrame >= 1 / 60) {
          lastFrame = simTime;
          const b0 = sim.balls[0];
          x.set(b0.x, simTime);
          y.set(1 - b0.y, simTime);
          frames.push({ time: simTime, balls: sim.balls.map((b) => ({ x: b.x, y: b.y })), flash });
          flash = '';
          if (frames.length > 40) frames.shift();
        }
      }
    });
    return {
      inputs: {
        kick: { kind: 'gate', handler: (e) => sim.kick(e.value) },
        reset: { kind: 'gate', handler: () => sim.reset() },
      },
      outputs: {
        floor: { kind: 'gate', out: outs.floor },
        wall: { kind: 'gate', out: outs.wall },
        hit: { kind: 'gate', out: outs.hit },
        x: { kind: 'node', node: x.node },
        y: { kind: 'node', node: y.node },
      },
      setParam(id, v) {
        p[id] = v;
        if (id === 'count') sim.fit();
      },
      getState(now) {
        let f: Frame | undefined;
        for (const fr of frames) if (fr.time <= now) f = fr;
        return { balls: f?.balls ?? [], size: p.size, flash: f?.flash ?? '' };
      },
      dispose() {
        remove();
        x.dispose();
        y.dispose();
      },
    };
  },
};
