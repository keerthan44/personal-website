// AudioWorkletProcessor 'pcm-capture': mic Float32 → Int16 PCM in 20 ms chunks.
// Posts {pcm: ArrayBuffer, level: number} with the buffer transferred.
// It has one output only so the graph can pull it to the destination (Safari);
// the output is never written, so it stays silent.
// The conversion math mirrors floatToInt16/rms in pcm.mjs (worklets can't import
// ES modules portably, so it is duplicated here).

class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    // `sampleRate` is a global in AudioWorkletGlobalScope.
    this.size = Math.round(sampleRate * 0.02);
    this.buf = new Int16Array(this.size);
    this.fill = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      let s = ch[i];
      if (Number.isNaN(s)) s = 0;
      if (s > 1) s = 1; else if (s < -1) s = -1;
      this.buf[this.fill++] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
      this.sumSq += s * s;
      if (this.fill === this.size) {
        const level = Math.sqrt(this.sumSq / this.size);
        const pcm = this.buf.buffer;
        this.port.postMessage({ pcm, level }, [pcm]);
        this.buf = new Int16Array(this.size);
        this.fill = 0;
        this.sumSq = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
