/** Topology-preserving state-variable filter: low, band and high pass from one stable structure. */
export class Svf {
  private ic1 = 0;
  private ic2 = 0;
  low = 0;
  band = 0;
  high = 0;

  /** Filter one sample at `fc` Hz with resonance `q` (0.5 is gentle, 10+ rings). */
  run(x: number, fc: number, q: number, sr: number): void {
    const g = Math.tan((Math.PI * Math.min(sr * 0.45, Math.max(10, fc))) / sr);
    const k = 1 / Math.max(0.5, q);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - this.ic2;
    const v1 = a1 * this.ic1 + a2 * v3;
    const v2 = this.ic2 + a2 * this.ic1 + a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.low = v2;
    this.band = v1;
    this.high = x - k * v1 - v2;
  }

  reset(): void {
    this.ic1 = this.ic2 = 0;
  }
}
