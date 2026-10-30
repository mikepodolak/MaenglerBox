import { Envelope, midiToHz, Stage } from './fm';
import type { PolyVoice } from './poly';

/**
 * Two-operator FM lead, after the Nord Lead 2's FM oscillator: a modulator
 * with its own envelope and feedback bends a carrier, then a resonant
 * low-pass with its own decaying envelope shapes it.
 */
export interface LeadParams {
  ratio: number;
  /** Modulator detune in cents. */
  fine: number;
  /** FM amount, 0..1. */
  index: number;
  modAttack: number;
  modDecay: number;
  modSustain: number;
  feedback: number;
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  cutoff: number;
  resonance: number;
  /** Octaves the filter envelope opens the cutoff by (negative closes it). */
  filterEnv: number;
  filterDecay: number;
  level: number;
}

export function defaultLeadParams(): LeadParams {
  return {
    ratio: 2,
    fine: 0,
    index: 0.45,
    modAttack: 0.001,
    modDecay: 0.35,
    modSustain: 0.2,
    feedback: 0.15,
    attack: 0.003,
    decay: 0.4,
    sustain: 0.6,
    release: 0.25,
    cutoff: 2500,
    resonance: 1.5,
    filterEnv: 2,
    filterDecay: 0.3,
    level: 0.8,
  };
}

const TWO_PI = Math.PI * 2;
const MAX_INDEX = TWO_PI * 2;

export class LeadVoice implements PolyVoice<LeadParams> {
  note = 60;
  startedAt = 0;
  releaseAt = Infinity;
  private velocity = 0;
  private params: LeadParams | null = null;
  private amp = new Envelope();
  private mod = new Envelope();
  private fenv = new Envelope();
  private pc = 0;
  private pm = 0;
  private fb = 0;
  private ic1 = 0;
  private ic2 = 0;

  get active(): boolean {
    return this.amp.stage !== Stage.Idle;
  }

  start(note: number, velocity: number, frame: number, releaseAt: number, params: LeadParams | null): void {
    this.note = note;
    this.velocity = velocity;
    this.startedAt = frame;
    this.releaseAt = releaseAt;
    this.params = params;
    this.amp.trigger();
    this.mod.trigger();
    this.fenv.trigger();
  }

  release(): void {
    this.releaseAt = Infinity;
    this.amp.release();
    this.mod.release();
    this.fenv.release();
  }

  render(live: LeadParams, sr: number): number {
    const p = this.params ?? live;
    const hz = midiToHz(this.note);
    const amp = this.amp.next(p, sr);
    const modEnv = this.mod.next({ attack: p.modAttack, decay: p.modDecay, sustain: p.modSustain, release: p.release }, sr);
    const fEnv = this.fenv.next({ attack: 0.001, decay: p.filterDecay, sustain: 0, release: p.release }, sr);
    const m = Math.sin(TWO_PI * this.pm + this.fb * p.feedback * Math.PI);
    this.fb = m;
    const c = Math.sin(TWO_PI * this.pc + m * p.index * modEnv * MAX_INDEX);
    this.pm += (hz * p.ratio * Math.pow(2, p.fine / 1200)) / sr;
    this.pm -= Math.floor(this.pm);
    this.pc += hz / sr;
    this.pc -= Math.floor(this.pc);
    // Topology-preserving state-variable low-pass (stable at any cutoff and resonance).
    const fc = Math.min(sr * 0.45, Math.max(20, p.cutoff * Math.pow(2, p.filterEnv * fEnv)));
    const g = Math.tan((Math.PI * fc) / sr);
    const k = 1 / Math.max(0.5, p.resonance);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = c - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    return v2 * amp * this.velocity;
  }
}
