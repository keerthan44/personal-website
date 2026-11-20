// Shared fakes for voice engine tests (no DOM).
export function makeClock(start = 0) {
  let t = start;
  let seq = 0;
  const timers = new Map();
  const clock = {
    now: () => t,
    setTimer: (fn, ms) => { const id = ++seq; timers.set(id, { at: t + Math.max(0, ms || 0), fn }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    pending: () => timers.size,
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        let nextId = null; let next = null;
        for (const [id, tm] of timers) if (tm.at <= end && (!next || tm.at < next.at)) { next = tm; nextId = id; }
        if (!next) break;
        timers.delete(nextId);
        t = next.at;
        next.fn();
        await flush();
      }
      t = end;
      await flush();
    },
  };
  return clock;
}

export async function flush() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}

export class FakeParam { constructor(v = 1) { this.value = v; } }

export function makeAudioContextClass(clock, { nativeRate = 44100 } = {}) {
  const instances = [];
  class FakeAudioContext {
    constructor(opts = {}) {
      this.sampleRate = opts.sampleRate || nativeRate;
      this.state = 'suspended';
      this.resumed = 0;
      this.closed = 0;
      this.sources = [];
      this.analysers = [];
      this.destination = { kind: 'destination' };
      this.modules = [];
      this.audioWorklet = { addModule: async (url) => { this.modules.push(String(url)); } };
      instances.push(this);
    }
    get currentTime() { return clock.now() / 1000; }
    resume() { this.resumed++; this.state = 'running'; return Promise.resolve(); }
    close() { this.closed++; this.state = 'closed'; return Promise.resolve(); }
    createBuffer(ch, length, rate) {
      const data = new Float32Array(length);
      return { numberOfChannels: ch, length, sampleRate: rate, duration: length / rate, getChannelData: () => data, copyToChannel: (src) => data.set(src) };
    }
    createBufferSource() {
      const src = {
        buffer: null, startedAt: null, stopped: 0, connectedTo: [], onended: null,
        connect(n) { this.connectedTo.push(n); return n; },
        disconnect() {},
        start(t) { this.startedAt = t; },
        stop() { this.stopped++; },
      };
      this.sources.push(src);
      return src;
    }
    createGain() {
      return { gain: new FakeParam(1), disconnected: 0, connectedTo: [], connect(n) { this.connectedTo.push(n); return n; }, disconnect() { this.disconnected++; } };
    }
    createAnalyser() {
      const a = {
        fftSize: 2048, value: 0, connectedTo: [],
        connect(n) { this.connectedTo.push(n); return n; }, disconnect() {},
        getFloatTimeDomainData(arr) { arr.fill(this.value); },
      };
      this.analysers.push(a);
      return a;
    }
    createMediaStreamSource(stream) {
      return { stream, connectedTo: [], connect(n) { this.connectedTo.push(n); return n; }, disconnect() {} };
    }
  }
  FakeAudioContext.instances = instances;
  return FakeAudioContext;
}
