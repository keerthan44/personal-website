// Gapless playback of raw linear16 PCM chunks from the agent.
// Graph: AudioBufferSourceNode(s) → per-utterance GainNode → shared AnalyserNode → destination.
import { int16ToFloat, rms } from './pcm.mjs';

export class Player {
  constructor(ctx, rate = 24000) {
    this.ctx = ctx;
    this.rate = rate;
    this.nextStart = 0;
    this.sources = new Set();
    this.gain = null;
    this.closed = false;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.connect(ctx.destination);
    this.scratch = null;
  }

  enqueue(buf) {
    if (this.closed) return;
    const i16 = new Int16Array(buf, 0, Math.floor(buf.byteLength / 2));
    if (!i16.length) return;
    const ctx = this.ctx;
    const audio = ctx.createBuffer(1, i16.length, this.rate);
    audio.getChannelData(0).set(int16ToFloat(i16));
    if (!this.gain) {
      this.gain = ctx.createGain();
      this.gain.connect(this.analyser);
    }
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(this.gain);
    const at = Math.max(ctx.currentTime, this.nextStart);
    src.onended = () => { this.sources.delete(src); };
    this.sources.add(src);
    src.start(at);
    this.nextStart = at + audio.duration;
  }

  /** Barge-in: stop everything scheduled, drop the utterance gain, reset the clock. */
  flush() {
    for (const src of this.sources) {
      src.onended = null;
      try { src.stop(); } catch { /* already stopped */ }
      try { src.disconnect(); } catch { /* ignore */ }
    }
    this.sources.clear();
    if (this.gain) {
      try { this.gain.disconnect(); } catch { /* ignore */ }
      this.gain = null;
    }
    this.nextStart = 0;
  }

  /** Output level 0..1 from the analyser (rms scaled ×4, clamped). */
  get level() {
    if (this.closed) return 0;
    const n = this.analyser.fftSize;
    if (!this.scratch || this.scratch.length !== n) this.scratch = new Float32Array(n);
    this.analyser.getFloatTimeDomainData(this.scratch);
    return Math.min(1, Math.max(0, rms(this.scratch) * 4));
  }

  /** Milliseconds of scheduled audio still to play. */
  get drainMs() {
    return Math.max(0, (this.nextStart - this.ctx.currentTime) * 1000);
  }

  get busy() {
    return this.drainMs > 0;
  }

  close() {
    if (this.closed) return;
    this.flush();
    try { this.analyser.disconnect(); } catch { /* ignore */ }
    this.closed = true;
  }
}
