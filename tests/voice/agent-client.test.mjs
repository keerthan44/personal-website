import test from 'node:test';
import assert from 'node:assert';
import { createVoiceCall } from '../../public/voice/agent-client.mjs';
import { makeClock, makeAudioContextClass, flush } from './fakes.mjs';

const SETTINGS = {
  type: 'Settings',
  audio: { input: { encoding: 'linear16', sample_rate: 1 }, output: { encoding: 'linear16', sample_rate: 24000, container: 'none' } },
  agent: { greeting: 'hi' },
};

function makeWS() {
  const instances = [];
  class FakeWS {
    constructor(url, protocols) {
      this.url = url; this.protocols = protocols; this.sent = []; this.readyState = 0; this.closes = [];
      this.binaryType = 'blob';
      instances.push(this);
    }
    send(d) { if (this.readyState !== 1) throw new Error('not open'); this.sent.push(d); }
    close(code) { this.closes.push(code); this.readyState = 3; }
    // test helpers
    open() { this.readyState = 1; this.onopen?.({}); }
    srv(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }
    bin(buf) { this.onmessage?.({ data: buf }); }
    drop(code = 1006) { this.readyState = 3; this.onclose?.({ code, reason: '' }); }
    json() { return this.sent.filter((d) => typeof d === 'string').map((d) => JSON.parse(d)); }
    binary() { return this.sent.filter((d) => typeof d !== 'string'); }
  }
  FakeWS.instances = instances;
  return FakeWS;
}

function makeWorkletNodeClass() {
  const nodes = [];
  class FakeNode {
    constructor(ctx, name, options) { this.ctx = ctx; this.name = name; this.options = options; this.port = { onmessage: null, close() {} }; this.disconnected = 0; this.connectedTo = []; nodes.push(this); }
    connect(n) { this.connectedTo.push(n); return n; } disconnect() { this.disconnected++; }
    emit(level = 0.1, n = 882) { this.port.onmessage?.({ data: { pcm: new Int16Array(n).buffer, level } }); }
  }
  FakeNode.nodes = nodes;
  return FakeNode;
}

function setup({ tokenStatus = 200, tokenBody, micError, opts = {} } = {}) {
  const clock = makeClock(0);
  const WS = makeWS();
  const Ctx = makeAudioContextClass(clock, { nativeRate: 44100 });
  const Node = makeWorkletNodeClass();
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    const body = tokenBody || (tokenStatus === 200 ? { token: 'jwt', expiresIn: 30, settings: SETTINGS }
      : tokenStatus === 429 ? { error: 'rate_limited', retryAfter: 60 } : { error: 'unavailable' });
    return { ok: tokenStatus >= 200 && tokenStatus < 300, status: tokenStatus, json: async () => body };
  };
  const tracks = [{ stopped: 0, enabled: true, stop() { this.stopped++; } }];
  const gumCalls = [];
  const getUserMedia = async (c) => {
    gumCalls.push(c);
    if (micError) { const e = new Error('nope'); e.name = micError; throw e; }
    return { getTracks: () => tracks, getAudioTracks: () => tracks };
  };
  const pagehide = { fn: null, removed: 0 };
  const addPageHide = (fn) => { pagehide.fn = fn; return () => { pagehide.removed++; }; };
  const call = createVoiceCall({
    WebSocketImpl: WS, fetchImpl, getUserMedia, AudioContextImpl: Ctx, AudioWorkletNodeImpl: Node,
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, addPageHide,
    workletUrl: 'test://capture-worklet.js',
    ...opts,
  });
  const events = [];
  for (const e of ['state', 'text', 'latency', 'warning', 'mic', 'error', 'end']) call.on(e, (p) => events.push([e, p]));
  const of = (name) => events.filter(([e]) => e === name).map(([, p]) => p);
  const states = () => of('state').map((s) => s.state);
  return { clock, WS, Ctx, Node, fetchCalls, gumCalls, tracks, pagehide, call, events, of, states };
}

// Start a call and drive it to SettingsApplied.
async function connected(o) {
  const s = setup(o);
  const p = s.call.start();
  await flush();
  const ws = s.WS.instances[0];
  ws.open();
  ws.srv({ type: 'Welcome', request_id: 'r' });
  await flush();
  ws.srv({ type: 'SettingsApplied' });
  await p;
  return { ...s, ws };
}

test('start POSTs to tokenUrl, opens WS with bearer protocols, sends Settings only after Welcome', async () => {
  const s = setup();
  const p = s.call.start();
  // contexts are created and resumed synchronously, inside the user gesture
  assert.strictEqual(s.Ctx.instances.length, 2);
  assert.ok(s.Ctx.instances.every((c) => c.resumed === 1));
  assert.ok(s.Ctx.instances.some((c) => c.sampleRate === 48000));
  assert.strictEqual(s.gumCalls.length, 1);
  assert.deepStrictEqual(s.gumCalls[0], { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  assert.deepStrictEqual(s.states(), ['connecting']);
  await flush();
  assert.strictEqual(s.fetchCalls[0].url, '/api/voice-token');
  assert.strictEqual(s.fetchCalls[0].init.method, 'POST');
  const ws = s.WS.instances[0];
  assert.ok(ws, 'websocket opened');
  assert.strictEqual(ws.url, 'wss://agent.deepgram.com/v1/agent/converse');
  assert.deepStrictEqual(ws.protocols, ['bearer', 'jwt']);
  assert.strictEqual(ws.binaryType, 'arraybuffer');
  ws.open();
  await flush();
  assert.strictEqual(ws.sent.length, 0, 'nothing sent before Welcome');
  ws.srv({ type: 'Welcome', request_id: 'r' });
  await flush();
  const msgs = ws.json();
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].type, 'Settings');
  assert.strictEqual(msgs[0].audio.input.sample_rate, 44100);
  assert.strictEqual(SETTINGS.audio.input.sample_rate, 1, 'token settings not mutated');
  assert.strictEqual(s.Node.nodes[0].name, 'pcm-capture');
  assert.deepStrictEqual(s.Ctx.instances.find((c) => c.sampleRate === 44100).modules, ['test://capture-worklet.js']);
  ws.srv({ type: 'SettingsApplied' });
  await p;
  assert.deepStrictEqual(s.states(), ['connecting', 'listening']);
  assert.deepStrictEqual(s.of('mic'), [{ available: true }]);
  assert.strictEqual(s.call.micAvailable, true);
  s.call.end();
});

test('no binary is sent before SettingsApplied; afterwards worklet pcm is sent as binary', async () => {
  const s = setup();
  const p = s.call.start();
  await flush();
  const ws = s.WS.instances[0];
  ws.open();
  ws.srv({ type: 'Welcome' });
  await flush();
  const node = s.Node.nodes[0];
  node.emit(0.2);
  node.emit(0.2);
  assert.strictEqual(ws.binary().length, 0);
  ws.srv({ type: 'SettingsApplied' });
  await p;
  node.emit(0.2);
  assert.strictEqual(ws.binary().length, 1);
  assert.ok(ws.binary()[0] instanceof ArrayBuffer);
  s.call.setMicEnabled(false);
  node.emit(0.2);
  assert.strictEqual(ws.binary().length, 1, 'muted mic sends nothing');
  assert.strictEqual(s.tracks[0].enabled, false);
  s.call.setMicEnabled(true);
  node.emit(0.2);
  assert.strictEqual(ws.binary().length, 2);
  s.call.end();
});

test('levels.you follows the mic and decays to ~0 within 300 ms; levels.agent reads the player', async () => {
  const s = await connected();
  assert.deepStrictEqual(s.call.levels, { you: 0, agent: 0 });
  for (let i = 0; i < 5; i++) { s.Node.nodes[0].emit(0.2); await s.clock.advance(20); }
  assert.ok(s.call.levels.you > 0.3, `you=${s.call.levels.you}`);
  assert.ok(s.call.levels.you <= 1);
  await s.clock.advance(300);
  assert.ok(s.call.levels.you < 0.05, `you after silence=${s.call.levels.you}`);
  const playCtx = s.Ctx.instances.find((c) => c.sampleRate === 48000);
  assert.strictEqual(playCtx.analysers.length, 1);
  playCtx.analysers[0].value = 0.1;
  assert.ok(Math.abs(s.call.levels.agent - 0.4) < 1e-6, `agent=${s.call.levels.agent}`);
  s.call.setMicEnabled(false);
  assert.strictEqual(s.call.levels.you, 0);
  s.call.end();
});

test('capture worklet is pulled through a zero-gain node into the capture destination (Safari)', async () => {
  const s = await connected();
  const capture = s.Ctx.instances.find((c) => c.sampleRate === 44100);
  const node = s.Node.nodes[0];
  assert.strictEqual(node.options.numberOfOutputs, 1);
  assert.deepStrictEqual(node.options.outputChannelCount, [1]);
  assert.strictEqual(node.connectedTo.length, 1);
  const sink = node.connectedTo[0];
  assert.strictEqual(sink.gain.value, 0);
  assert.deepStrictEqual(sink.connectedTo, [capture.destination]);
  s.call.end();
  assert.strictEqual(sink.disconnected, 1, 'sink gain disconnected on end');
  assert.strictEqual(node.disconnected, 1);
});

test('UserStartedSpeaking while audio is queued flushes the player and enters interrupted', async () => {
  const s = await connected();
  s.ws.srv({ type: 'ConversationText', role: 'assistant', content: 'Hello' });
  s.ws.bin(new Int16Array(24000).buffer);
  s.ws.bin(new Int16Array(24000).buffer);
  assert.strictEqual(s.states().at(-1), 'speaking');
  const playCtx = s.Ctx.instances.find((c) => c.sampleRate === 48000);
  s.ws.srv({ type: 'UserStartedSpeaking' });
  assert.ok(playCtx.sources.every((src) => src.stopped === 1));
  assert.strictEqual(s.states().at(-1), 'interrupted');
  // when nothing is playing it just goes back to listening
  s.ws.srv({ type: 'UserStartedSpeaking' });
  assert.strictEqual(s.states().at(-1), 'listening');
  s.call.end();
});

test('ConversationText becomes text events with user/agent roles and drives state', async () => {
  const s = await connected();
  s.ws.srv({ type: 'ConversationText', role: 'user', content: 'Who is Keerthan?' });
  assert.strictEqual(s.states().at(-1), 'thinking');
  s.ws.srv({ type: 'ConversationText', role: 'assistant', content: 'An engineer.' });
  assert.deepStrictEqual(s.of('text'), [{ role: 'user', text: 'Who is Keerthan?' }, { role: 'agent', text: 'An engineer.' }]);
  s.ws.srv({ type: 'AgentThinking', content: '...' });
  assert.strictEqual(s.states().at(-1), 'thinking');
  s.call.end();
});

test('player drained after AgentAudioDone returns to listening', async () => {
  const s = await connected();
  s.ws.bin(new Int16Array(4800).buffer); // 200 ms
  assert.strictEqual(s.states().at(-1), 'speaking');
  s.ws.srv({ type: 'AgentAudioDone' });
  assert.strictEqual(s.states().at(-1), 'speaking');
  await s.clock.advance(400);
  assert.strictEqual(s.states().at(-1), 'listening');
  s.call.end();
});

test('LatencyReport total_latency becomes a latency event', async () => {
  const s = await connected();
  s.ws.srv({ type: 'LatencyReport', total_latency: 0.92 });
  assert.deepStrictEqual(s.of('latency'), [{ seconds: 0.92 }]);
  s.call.end();
});

test('latency precedence: LatencyReport beats AgentStartedSpeaking; one event per turn', async () => {
  const s = await connected();
  s.ws.srv({ type: 'ConversationText', role: 'user', content: 'q' });
  s.ws.srv({ type: 'AgentStartedSpeaking', total_latency: 1.5 });
  assert.strictEqual(s.states().at(-1), 'speaking');
  s.ws.bin(new Int16Array(2400).buffer);
  s.ws.srv({ type: 'AgentAudioDone' });
  s.ws.srv({ type: 'LatencyReport', total_latency: 0.8 });
  await s.clock.advance(5000);
  assert.deepStrictEqual(s.of('latency'), [{ seconds: 0.8 }]);
  s.call.end();
});

test('latency falls back to AgentStartedSpeaking, then to client measurement', async () => {
  const s = await connected();
  s.ws.srv({ type: 'ConversationText', role: 'user', content: 'q' });
  s.ws.srv({ type: 'AgentStartedSpeaking', total_latency: 1.25 });
  s.ws.bin(new Int16Array(2400).buffer);
  s.ws.srv({ type: 'AgentAudioDone' });
  await s.clock.advance(5000);
  assert.deepStrictEqual(s.of('latency'), [{ seconds: 1.25 }]);

  s.ws.srv({ type: 'ConversationText', role: 'user', content: 'q2' });
  await s.clock.advance(700);
  s.ws.bin(new Int16Array(2400).buffer);
  s.ws.srv({ type: 'AgentAudioDone' });
  await s.clock.advance(5000);
  const lat = s.of('latency');
  assert.strictEqual(lat.length, 2);
  assert.ok(Math.abs(lat[1].seconds - 0.7) < 1e-9, `client latency ${lat[1].seconds}`);
  s.call.end();
});

test('token 429 → rate_limited error and end(error), no WebSocket opened', async () => {
  const s = setup({ tokenStatus: 429 });
  await s.call.start();
  await flush();
  assert.strictEqual(s.WS.instances.length, 0);
  assert.strictEqual(s.of('error')[0].kind, 'rate_limited');
  assert.deepStrictEqual(s.of('end'), [{ reason: 'error' }]);
  assert.strictEqual(s.states().at(-1), 'ended');
  assert.strictEqual(s.tracks[0].stopped, 1, 'mic released');
  assert.ok(s.Ctx.instances.every((c) => c.closed === 1));
});

test('token 503 → token error', async () => {
  const s = setup({ tokenStatus: 503 });
  await s.call.start();
  await flush();
  assert.strictEqual(s.of('error')[0].kind, 'token');
  assert.deepStrictEqual(s.of('end'), [{ reason: 'error' }]);
});

test('fetch rejecting → network error', async () => {
  const s = setup({ opts: { fetchImpl: async () => { throw new TypeError('offline'); } } });
  await s.call.start();
  await flush();
  assert.strictEqual(s.of('error')[0].kind, 'network');
  assert.deepStrictEqual(s.of('end'), [{ reason: 'error' }]);
});

test('WS closing before SettingsApplied → connect error', async () => {
  const s = setup();
  const p = s.call.start();
  await flush();
  const ws = s.WS.instances[0];
  ws.open();
  ws.srv({ type: 'Welcome' });
  await flush();
  ws.drop(1006);
  await p;
  assert.strictEqual(s.of('error')[0].kind, 'connect');
  assert.deepStrictEqual(s.of('end'), [{ reason: 'error' }]);
});

test('WS closing after SettingsApplied ends with remote', async () => {
  const s = await connected();
  s.ws.drop(1000);
  assert.deepStrictEqual(s.of('end'), [{ reason: 'remote' }]);
  assert.strictEqual(s.of('error').length, 0);
});

test('Error frame → agent error and end', async () => {
  const s = await connected();
  s.ws.srv({ type: 'Error', code: 'FAILED_TO_THINK', description: 'boom' });
  assert.deepStrictEqual(s.of('error'), [{ kind: 'agent', message: 'boom' }]);
  assert.deepStrictEqual(s.of('end'), [{ reason: 'error' }]);
  assert.deepStrictEqual(s.ws.closes, [1000]);
});

test('mic denied → mic event, 16 kHz settings, still reaches listening, KeepAlive every 8 s', async () => {
  const s = setup({ micError: 'NotAllowedError' });
  const p = s.call.start();
  await flush();
  assert.deepStrictEqual(s.of('mic'), [{ available: false, reason: 'denied' }]);
  assert.strictEqual(s.call.micAvailable, false);
  const ws = s.WS.instances[0];
  ws.open();
  ws.srv({ type: 'Welcome' });
  await flush();
  assert.strictEqual(ws.json()[0].audio.input.sample_rate, 16000);
  ws.srv({ type: 'SettingsApplied' });
  await p;
  assert.strictEqual(s.states().at(-1), 'listening');
  const capture = s.Ctx.instances.find((c) => c.sampleRate === 44100);
  assert.strictEqual(capture.closed, 1, 'unused capture context closed');
  const ka = () => ws.json().filter((m) => m.type === 'KeepAlive').length;
  assert.strictEqual(ka(), 0);
  await s.clock.advance(8000);
  assert.strictEqual(ka(), 1);
  await s.clock.advance(8000);
  assert.strictEqual(ka(), 2);
  assert.strictEqual(ws.binary().length, 0);
  s.call.end();
});

test('mic NotFoundError → unavailable', async () => {
  const s = setup({ micError: 'NotFoundError' });
  s.call.start();
  await flush();
  assert.deepStrictEqual(s.of('mic'), [{ available: false, reason: 'unavailable' }]);
  s.call.end();
});

test('sendText sends InjectUserMessage with content', async () => {
  const s = await connected();
  s.call.sendText('hello there');
  assert.deepStrictEqual(s.ws.json().at(-1), { type: 'InjectUserMessage', content: 'hello there' });
  s.call.end();
});

test('warning once at 150 s; at 180 s InjectAgentMessage interrupt, then end(cap) within 6 s', async () => {
  const s = await connected();
  await s.clock.advance(149_000);
  assert.strictEqual(s.of('warning').length, 0);
  await s.clock.advance(1_000);
  assert.deepStrictEqual(s.of('warning'), [{ secondsLeft: 30 }]);
  await s.clock.advance(29_000);
  assert.strictEqual(s.of('warning').length, 1);
  assert.ok(!s.ws.json().some((m) => m.type === 'InjectAgentMessage'));
  await s.clock.advance(1_000);
  const inj = s.ws.json().filter((m) => m.type === 'InjectAgentMessage');
  assert.deepStrictEqual(inj, [{
    type: 'InjectAgentMessage',
    message: "That's our three minutes. Thanks for calling! You'll find Keerthan's contact details at the bottom of the page.",
    behavior: 'interrupt',
  }]);
  assert.strictEqual(s.of('end').length, 0);
  await s.clock.advance(6_000);
  assert.deepStrictEqual(s.of('end'), [{ reason: 'cap' }]);
});

test('cap ends as soon as the goodbye has played out', async () => {
  const s = await connected();
  await s.clock.advance(180_000);
  s.ws.bin(new Int16Array(4800).buffer); // 200 ms goodbye
  s.ws.srv({ type: 'AgentAudioDone' });
  await s.clock.advance(500);
  assert.deepStrictEqual(s.of('end'), [{ reason: 'cap' }]);
});

test('end() twice → one close(1000), tracks stopped, contexts closed, one end event', async () => {
  const s = await connected();
  s.call.end();
  s.call.end('cap');
  assert.deepStrictEqual(s.ws.closes, [1000]);
  assert.strictEqual(s.tracks[0].stopped, 1);
  assert.ok(s.Ctx.instances.every((c) => c.closed === 1));
  assert.deepStrictEqual(s.of('end'), [{ reason: 'user' }]);
  assert.strictEqual(s.states().filter((x) => x === 'ended').length, 1);
  assert.strictEqual(s.pagehide.removed, 1);
  assert.strictEqual(s.clock.pending(), 0, 'no timers left behind');
  assert.deepStrictEqual(s.call.levels, { you: 0, agent: 0 });
});

test('pagehide ends the call as user', async () => {
  const s = await connected();
  s.pagehide.fn();
  assert.deepStrictEqual(s.of('end'), [{ reason: 'user' }]);
});

test('end() during token fetch opens no socket and releases the mic later', async () => {
  const s = setup();
  const p = s.call.start();
  s.call.end();
  await p;
  await flush();
  assert.strictEqual(s.WS.instances.length, 0);
  assert.strictEqual(s.tracks[0].stopped, 1);
  assert.deepStrictEqual(s.of('end'), [{ reason: 'user' }]);
});

test('on() returns an unsubscribe function', async () => {
  const s = setup();
  const seen = [];
  const off = s.call.on('state', (p) => seen.push(p.state));
  off();
  s.call.start();
  s.call.end();
  assert.deepStrictEqual(seen, []);
});

test('token is re-fetched when the mic prompt outlives it', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = setup({ opts: { getUserMedia: async () => { await gate; return { getTracks: () => [] }; } } });
  const p = s.call.start();
  await flush();
  assert.strictEqual(s.fetchCalls.length, 1);
  assert.strictEqual(s.WS.instances.length, 0, 'socket waits for the mic decision');
  await s.clock.advance(40_000);
  release();
  await flush();
  assert.strictEqual(s.fetchCalls.length, 2);
  assert.strictEqual(s.WS.instances.length, 1);
  s.call.end();
  await p;
});
