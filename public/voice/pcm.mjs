// Pure PCM helpers shared by the voice engine (and mirrored in capture-worklet.js).

/** Float32 [-1, 1] → little-endian signed 16-bit PCM, clamped. */
export function floatToInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    let s = f32[i];
    if (Number.isNaN(s)) s = 0;
    if (s > 1) s = 1; else if (s < -1) s = -1;
    out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
  }
  return out;
}

/** Signed 16-bit PCM → Float32 [-1, 1]. */
export function int16ToFloat(i16) {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) {
    const v = i16[i];
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

/** Root-mean-square level of a Float32 block (0 for empty input). */
export function rms(f32) {
  if (!f32.length) return 0;
  let sum = 0;
  for (let i = 0; i < f32.length; i++) sum += f32[i] * f32[i];
  return Math.sqrt(sum / f32.length);
}

/** Accumulates Int16 samples and hands back fixed-size chunks. */
export class Batcher {
  constructor(size) {
    this.size = size;
    this.buf = new Int16Array(size);
    this.fill = 0;
  }

  push(i16) {
    const chunks = [];
    let off = 0;
    while (off < i16.length) {
      const n = Math.min(this.size - this.fill, i16.length - off);
      this.buf.set(i16.subarray(off, off + n), this.fill);
      this.fill += n;
      off += n;
      if (this.fill === this.size) {
        chunks.push(this.buf);
        this.buf = new Int16Array(this.size);
        this.fill = 0;
      }
    }
    return chunks;
  }
}
