/**
 * Builds a 24-bit stereo WAV file as audio arrives, so a long recording is
 * kept as 6 bytes a frame instead of 8 bytes of floats.
 */
export class WavWriter {
  private chunks: Uint8Array[] = [];
  private frames = 0;

  constructor(readonly sampleRate: number) {}

  /** Append a block of left and right samples (-1..1; louder is clipped). */
  push(left: Float32Array, right: Float32Array): void {
    const n = left.length;
    const out = new Uint8Array(n * 6);
    let o = 0;
    for (let i = 0; i < n; i++) {
      for (const x of [left[i], right[i]]) {
        const s = Math.round(Math.max(-1, Math.min(1, x)) * 8388607);
        out[o++] = s & 0xff;
        out[o++] = (s >> 8) & 0xff;
        out[o++] = (s >> 16) & 0xff;
      }
    }
    this.chunks.push(out);
    this.frames += n;
  }

  get seconds(): number {
    return this.frames / this.sampleRate;
  }

  /** The finished file. */
  blob(): Blob {
    return new Blob([wavHeader(this.sampleRate, this.frames), ...this.chunks] as BlobPart[], { type: 'audio/wav' });
  }
}

/** The 44-byte header of a 24-bit stereo PCM WAV holding `frames` frames. */
export function wavHeader(sampleRate: number, frames: number): Uint8Array {
  const channels = 2;
  const bytesPerSample = 3;
  const dataBytes = frames * channels * bytesPerSample;
  const b = new DataView(new ArrayBuffer(44));
  const tag = (at: number, s: string) => [...s].forEach((c, i) => b.setUint8(at + i, c.charCodeAt(0)));
  tag(0, 'RIFF');
  b.setUint32(4, 36 + dataBytes, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, channels, true);
  b.setUint32(24, sampleRate, true);
  b.setUint32(28, sampleRate * channels * bytesPerSample, true);
  b.setUint16(32, channels * bytesPerSample, true);
  b.setUint16(34, bytesPerSample * 8, true);
  tag(36, 'data');
  b.setUint32(40, dataBytes, true);
  return new Uint8Array(b.buffer);
}
