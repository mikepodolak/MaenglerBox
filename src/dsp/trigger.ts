/** A rising edge found in a CV or audio signal. */
export interface Trigger {
  /** Sample frame where the signal crossed the high threshold. */
  frame: number;
  /** Peak level reached while high, 0..1 (reported at the edge, so the first sample's level). */
  value: number;
}

/**
 * Schmitt trigger, as on VCV Rack and Eurorack gate inputs: fires once when
 * the signal rises above `high`, and re-arms only after it falls below `low`,
 * so a noisy or slow signal doesn't fire twice.
 */
export class TriggerDetector {
  private armed = true;

  constructor(
    private readonly high = 0.5,
    private readonly low = 0.25,
  ) {}

  process(samples: Float32Array, startFrame: number): Trigger[] {
    const found: Trigger[] = [];
    for (let i = 0; i < samples.length; i++) {
      const x = samples[i];
      if (this.armed && x >= this.high) {
        this.armed = false;
        found.push({ frame: startFrame + i, value: Math.min(1, x) });
      } else if (!this.armed && x <= this.low) {
        this.armed = true;
      }
    }
    return found;
  }
}
