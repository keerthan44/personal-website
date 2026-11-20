// Browser engine for a Deepgram Voice Agent call.
// Plain ES module, no bundler. Every browser global is injectable through `opts`
// so the engine can be tested in Node with fakes.
import { Player } from './playback.mjs';

const AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';
const CAP_MESSAGE = "That's our three minutes. Thanks for calling! You'll find Keerthan's contact details at the bottom of the page.";
const KEEPALIVE_MS = 8000;      // Deepgram wants one every 8 s while no audio is flowing
const AUDIO_IDLE_MS = 1000;     // no mic frame sent for this long counts as "not streaming"
const CAP_GRACE_MS = 6000;      // hard stop after the goodbye is injected
const LATENCY_GRACE_MS = 1500;  // wait this long after AgentAudioDone for a LatencyReport
const DRAIN_SLACK_MS = 30;
const YOU_DECAY_MS = 80;        // mic level time constant: ~0 within ~300 ms of silence
const NO_MIC_RATE = 16000;
const MIC_CONSTRAINTS = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } };

const clamp01 = (x) => (x > 1 ? 1 : x > 0 ? x : 0);

function defaultAddPageHide(fn) {
  if (typeof window === 'undefined' || !window.addEventListener) return () => {};
  window.addEventListener('pagehide', fn);
  return () => window.removeEventListener('pagehide', fn);
}

function defaultGetUserMedia() {
  const md = typeof navigator !== 'undefined' && navigator.mediaDevices;
  return md && md.getUserMedia ? (c) => md.getUserMedia(c) : null;
}

export function createVoiceCall(opts = {}) {
  const {
    tokenUrl = '/api/voice-token',
    capSeconds = 180,
    warnAtSeconds = 150,
    agentUrl = AGENT_URL,
    WebSocketImpl = globalThis.WebSocket,
    fetchImpl = globalThis.fetch ? globalThis.fetch.bind(globalThis) : undefined,
    getUserMedia = defaultGetUserMedia(),
    AudioContextImpl = globalThis.AudioContext || globalThis.webkitAudioContext,
    AudioWorkletNodeImpl = globalThis.AudioWorkletNode,
    now = () => (globalThis.performance ? globalThis.performance.now() : Date.now()),
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (id) => clearTimeout(id),
    addPageHide = defaultAddPageHide,
    workletUrl = new URL('./capture-worklet.js', import.meta.url),
  } = opts;

  const listeners = new Map();
  let state = null;
  let started = false;
  let ended = false;

  let captureCtx = null;
  let playCtx = null;
  let player = null;
  let micStream = null;
  let micSource = null;
  let micNode = null;
  let micSink = null;
  let micAvailable = false;
  let micEnabled = true;

  let ws = null;
  let settingsTemplate = null;
  let settingsSent = false;
  let applied = false;
  let lastAudioAt = -Infinity;

  let youLevel = 0;
  let youAt = 0;

  let audioDone = false;     // AgentAudioDone seen for the utterance now playing
  let capping = false;
  let capAudioSeen = false;  // goodbye audio has arrived since the cap fired
  let turn = { userAt: null, firstAudio: false, candidate: null, emitted: false };

  const timers = { keepAlive: null, warn: null, cap: null, capGrace: null, drain: null, latency: null };
  let removePageHide = null;
  let resolveReady = null;
  const ready = new Promise((r) => { resolveReady = r; });

  // ---------- events ----------
  function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (err) { console.error('[voice] listener error', err); }
    }
  }

  function on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => { listeners.get(event)?.delete(fn); };
  }

  function setState(next) {
    if (state === next) return;
    state = next;
    emit('state', { state: next });
  }

  function clear(name) {
    if (timers[name] != null) { clearTimer(timers[name]); timers[name] = null; }
  }

  function fail(err) {
    if (ended) return;
    emit('error', err);
    end('error');
  }

  function send(obj) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(typeof obj === 'string' || obj instanceof ArrayBuffer ? obj : JSON.stringify(obj)); return true; } catch { return false; }
  }

  // ---------- mic ----------
  function stopTracks(stream) {
    if (!stream) return;
    for (const t of stream.getTracks()) { try { t.stop(); } catch { /* ignore */ } }
  }

  function closeCtx(ctx) {
    if (!ctx) return;
    try { Promise.resolve(ctx.close()).catch(() => {}); } catch { /* ignore */ }
  }

  function micUnavailable(reason) {
    micAvailable = false;
    closeCtx(captureCtx);
    captureCtx = null;
    if (!ended) emit('mic', { available: false, reason });
  }

  async function setupMic() {
    if (!getUserMedia || !captureCtx || !AudioWorkletNodeImpl || !captureCtx.audioWorklet) {
      micUnavailable('unavailable');
      return;
    }
    let stream;
    try {
      stream = await getUserMedia(MIC_CONSTRAINTS);
    } catch (err) {
      const name = err && err.name;
      micUnavailable(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable');
      return;
    }
    if (ended) { stopTracks(stream); return; }
    micStream = stream;
    try {
      await captureCtx.audioWorklet.addModule(String(workletUrl));
      if (ended) return; // end() already released the stream
      micSource = captureCtx.createMediaStreamSource(stream);
      micNode = new AudioWorkletNodeImpl(captureCtx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1 });
      micNode.port.onmessage = onPcm;
      // WebKit only renders nodes that reach the destination, so pull the worklet
      // through a muted gain. The worklet leaves its output silent anyway.
      micSink = captureCtx.createGain();
      micSink.gain.value = 0;
      micNode.connect(micSink);
      micSink.connect(captureCtx.destination);
      micSource.connect(micNode);
    } catch (err) {
      if (ended) return;
      teardownMicGraph();
      stopTracks(micStream);
      micStream = null;
      micUnavailable('unavailable');
      return;
    }
    for (const t of stream.getTracks()) t.enabled = micEnabled;
    micAvailable = true;
    emit('mic', { available: true });
  }

  function teardownMicGraph() {
    if (micNode) {
      micNode.port.onmessage = null;
      try { micNode.disconnect(); } catch { /* ignore */ }
      micNode = null;
    }
    if (micSink) {
      try { micSink.disconnect(); } catch { /* ignore */ }
      micSink = null;
    }
    if (micSource) {
      try { micSource.disconnect(); } catch { /* ignore */ }
      micSource = null;
    }
  }

  function youNow() {
    return youLevel * Math.exp(-(now() - youAt) / YOU_DECAY_MS);
  }

  function onPcm(ev) {
    if (ended || !micEnabled) return;
    const { pcm, level } = ev.data || {};
    const target = clamp01((level || 0) * 4);
    const cur = youNow();
    youLevel = target > cur ? cur + (target - cur) * 0.6 : cur;
    youAt = now();
    if (applied && !capping && pcm && send(pcm)) lastAudioAt = now();
  }

  // ---------- token ----------
  async function fetchToken() {
    let res;
    try {
      res = await fetchImpl(tokenUrl, { method: 'POST', credentials: 'same-origin' });
    } catch (err) {
      return { error: { kind: 'network', message: (err && err.message) || 'Network error' } };
    }
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    if (res.status === 429) {
      const retryAfter = body && body.retryAfter;
      return { error: { kind: 'rate_limited', message: 'Too many calls right now. Please try again later.', retryAfter } };
    }
    if (!res.ok || !body || !body.token || !body.settings) {
      return { error: { kind: 'token', message: (body && body.error) || `Token request failed (${res.status})` } };
    }
    return { token: body.token, expiresIn: body.expiresIn, settings: body.settings, at: now() };
  }

  // ---------- socket ----------
  function openSocket(token) {
    try {
      ws = new WebSocketImpl(agentUrl, ['bearer', token]);
    } catch (err) {
      fail({ kind: 'connect', message: (err && err.message) || 'Could not open connection' });
      return;
    }
    ws.binaryType = 'arraybuffer';
    ws.onmessage = onMessage;
    ws.onclose = onClose;
    ws.onerror = () => {}; // a close event always follows
  }

  function onClose(ev) {
    if (ended) return;
    const code = ev && ev.code;
    if (!applied) {
      fail({ kind: 'connect', message: `Connection closed before the call started (${code})` });
    } else if (code === 1000) {
      end('remote');
    } else {
      fail({ kind: 'network', message: `Connection lost (${code})` });
    }
  }

  function onMessage(ev) {
    if (ended) return;
    const data = ev.data;
    if (typeof data === 'string') {
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (msg && typeof msg.type === 'string') onControl(msg);
    } else if (data instanceof ArrayBuffer) {
      onAudio(data);
    }
  }

  function onControl(msg) {
    switch (msg.type) {
      case 'Welcome': {
        if (settingsSent) return;
        settingsSent = true;
        const s = JSON.parse(JSON.stringify(settingsTemplate));
        s.audio = s.audio || {};
        s.audio.input = s.audio.input || {};
        s.audio.input.sample_rate = micAvailable && captureCtx ? captureCtx.sampleRate : NO_MIC_RATE;
        send(s);
        return;
      }
      case 'SettingsApplied':
        if (applied) return;
        applied = true;
        setState('listening');
        scheduleKeepAlive();
        startCapTimers();
        resolveReady();
        return;
      case 'ConversationText': {
        const role = msg.role === 'user' ? 'user' : 'agent';
        emit('text', { role, text: msg.content || '' });
        if (role === 'user') {
          beginTurn();
          if (!player.busy) setState('thinking');
        }
        return;
      }
      case 'UserStartedSpeaking': {
        const wasBusy = player.busy || state === 'speaking';
        player.flush();
        clear('drain');
        audioDone = false;
        turn.firstAudio = false;
        setState(wasBusy ? 'interrupted' : 'listening');
        return;
      }
      case 'AgentThinking':
        if (state !== 'speaking') setState('thinking');
        return;
      case 'AgentStartedSpeaking':
        if (typeof msg.total_latency === 'number' && !(turn.candidate && turn.candidate.rank >= 2)) {
          turn.candidate = { rank: 2, seconds: msg.total_latency };
        }
        setState('speaking');
        return;
      case 'AgentAudioDone':
        audioDone = true;
        scheduleDrainCheck();
        clear('latency');
        timers.latency = setTimer(() => { timers.latency = null; flushLatency(); }, LATENCY_GRACE_MS);
        return;
      case 'LatencyReport':
        if (typeof msg.total_latency === 'number') emitLatency(msg.total_latency);
        return;
      case 'Error':
        fail({ kind: 'agent', message: msg.description || msg.code || 'The agent hit an error' });
        return;
      default:
        // Warning, History, InjectionRefused, etc. are not surfaced.
    }
  }

  function onAudio(buf) {
    if (!applied) return;
    player.enqueue(buf);
    clear('drain');
    audioDone = false;
    if (capping) capAudioSeen = true;
    if (!turn.firstAudio) {
      turn.firstAudio = true;
      if (turn.userAt != null && !turn.candidate) turn.candidate = { rank: 1, seconds: (now() - turn.userAt) / 1000 };
    }
    setState('speaking');
  }

  // ---------- turns & latency ----------
  function beginTurn() {
    flushLatency();
    clear('latency');
    turn = { userAt: now(), firstAudio: false, candidate: null, emitted: false };
  }

  function emitLatency(seconds) {
    if (turn.emitted) return;
    turn.emitted = true;
    clear('latency');
    emit('latency', { seconds });
  }

  function flushLatency() {
    if (!turn.emitted && turn.candidate) emitLatency(turn.candidate.seconds);
  }

  function scheduleDrainCheck() {
    clear('drain');
    timers.drain = setTimer(checkDrain, player.drainMs + DRAIN_SLACK_MS);
  }

  function checkDrain() {
    timers.drain = null;
    if (ended || !audioDone) return;
    if (player.busy) { scheduleDrainCheck(); return; }
    audioDone = false;
    if (capping) {
      if (capAudioSeen) end('cap');
      return;
    }
    if (state === 'speaking') setState('listening');
  }

  // ---------- timers ----------
  function scheduleKeepAlive() {
    clear('keepAlive');
    timers.keepAlive = setTimer(() => {
      timers.keepAlive = null;
      if (ended) return;
      if (now() - lastAudioAt >= AUDIO_IDLE_MS) send({ type: 'KeepAlive' });
      scheduleKeepAlive();
    }, KEEPALIVE_MS);
  }

  function startCapTimers() {
    if (warnAtSeconds < capSeconds) {
      timers.warn = setTimer(() => {
        timers.warn = null;
        emit('warning', { secondsLeft: capSeconds - warnAtSeconds });
      }, warnAtSeconds * 1000);
    }
    timers.cap = setTimer(beginCap, capSeconds * 1000);
  }

  function beginCap() {
    timers.cap = null;
    if (ended) return;
    capping = true;
    capAudioSeen = false;
    player.flush();
    clear('drain');
    audioDone = false;
    send({ type: 'InjectAgentMessage', message: CAP_MESSAGE, behavior: 'interrupt' });
    timers.capGrace = setTimer(() => { timers.capGrace = null; end('cap'); }, CAP_GRACE_MS);
  }

  // ---------- public API ----------
  async function start() {
    if (started || ended) return ready;
    started = true;
    setState('connecting');

    // Create and resume both contexts synchronously so iOS/Safari count this
    // as part of the user gesture. Nothing above this line may await.
    if (!AudioContextImpl) {
      fail({ kind: 'connect', message: 'This browser cannot play audio (Web Audio unavailable).' });
      return ready;
    }
    try {
      // 48 kHz keeps Firefox echo cancellation happy; very old Safari rejects the option.
      try { playCtx = new AudioContextImpl({ sampleRate: 48000 }); } catch { playCtx = new AudioContextImpl(); }
      player = new Player(playCtx, 24000);
    } catch (err) {
      fail({ kind: 'connect', message: (err && err.message) || 'Could not start audio' });
      return ready;
    }
    try { captureCtx = new AudioContextImpl(); } catch { captureCtx = null; }
    for (const ctx of [captureCtx, playCtx]) {
      if (!ctx || !ctx.resume) continue;
      try { Promise.resolve(ctx.resume()).catch(() => {}); } catch { /* ignore */ }
    }
    removePageHide = addPageHide(() => end('user'));

    const micP = setupMic();
    if (!fetchImpl) { fail({ kind: 'network', message: 'fetch unavailable' }); return ready; }
    const tokenP = fetchToken();

    let tok = await tokenP;
    if (ended) return ready;
    if (tok.error) { fail(tok.error); return ready; }
    await micP;
    if (ended) return ready;
    // The permission prompt may have outlived the short-lived token.
    const ttlMs = (typeof tok.expiresIn === 'number' ? tok.expiresIn : 30) * 1000;
    if (now() - tok.at > ttlMs - 5000) {
      tok = await fetchToken();
      if (ended) return ready;
      if (tok.error) { fail(tok.error); return ready; }
    }
    if (!WebSocketImpl) { fail({ kind: 'connect', message: 'WebSocket unavailable' }); return ready; }
    settingsTemplate = tok.settings;
    openSocket(tok.token);
    return ready;
  }

  function end(reason = 'user') {
    if (ended) return;
    ended = true;
    for (const name of Object.keys(timers)) clear(name);
    if (removePageHide) { try { removePageHide(); } catch { /* ignore */ } removePageHide = null; }
    teardownMicGraph();
    stopTracks(micStream);
    micStream = null;
    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      if (ws.readyState === 0 || ws.readyState === 1) { try { ws.close(1000); } catch { /* ignore */ } }
      ws = null;
    }
    if (player) player.close();
    closeCtx(captureCtx);
    closeCtx(playCtx);
    captureCtx = null;
    playCtx = null;
    youLevel = 0;
    setState('ended');
    emit('end', { reason });
    resolveReady();
  }

  function sendText(text) {
    if (ended || !applied || typeof text !== 'string' || !text.trim()) return false;
    return send({ type: 'InjectUserMessage', content: text });
  }

  function setMicEnabled(on) {
    micEnabled = !!on;
    if (!micEnabled) youLevel = 0;
    if (micStream) for (const t of micStream.getTracks()) t.enabled = micEnabled;
  }

  return {
    start,
    end,
    sendText,
    setMicEnabled,
    on,
    get micAvailable() { return micAvailable; },
    get levels() {
      if (ended) return { you: 0, agent: 0 };
      return { you: micEnabled ? clamp01(youNow()) : 0, agent: player ? player.level : 0 };
    },
  };
}
