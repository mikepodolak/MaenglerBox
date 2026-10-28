/** A timed event on a gate cable. `time` is on the AudioContext clock. */
export interface GateEvent {
  time: number;
  /** 0..1 velocity / accent. */
  value: number;
  /** Seconds the gate stays high. */
  length: number;
  /** Optional pitch in MIDI note numbers, for note-carrying gates. */
  note?: number;
  /** Optional plain number riding with the event, e.g. which preset a synth should use (1-based). */
  index?: number;
}

export type GateHandler = (event: GateEvent) => void;

/** Output side of a gate port: fans events out to every connected input. */
export class GateOutput {
  private handlers = new Set<GateHandler>();

  connect(handler: GateHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  emit(event: GateEvent): void {
    for (const h of this.handlers) h(event);
  }
}
