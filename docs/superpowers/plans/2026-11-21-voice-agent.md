# Real voice agent for the portfolio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fake "Talk to my AI agent" call on `public/pro.html` with a real Deepgram Voice Agent call, driving the turn-taking orb from real call events and audio levels.

**Architecture:** The browser opens a WebSocket straight to Deepgram's Voice Agent API using a 30-second token minted by a Next.js API route that holds the real key. The agent's brain (résumé facts, prompt, Settings) lives in `voice-agent/` as plain ES modules shared by the API route and the tests. The browser voice engine lives in `public/voice/` as plain ES modules loaded without a bundler.

**Tech Stack:** Next.js 12 (pages router, existing app), plain ES modules, Web Audio API + AudioWorklet, Node 22 built-in test runner (`node --test`), three.js r128 (already on the page).

**Spec:** `docs/superpowers/specs/2026-11-21-voice-agent-design.md`
**Also read:** `docs/superpowers/specs/2026-11-21-voice-agent-a11y-requirements.md` (binding for Task 3), `docs/superpowers/specs/2026-11-21-deepgram-voice-agent-ref.md` (protocol reference: exact message names and shapes).

## Global Constraints

- $0: no new paid services, no new npm runtime dependencies. Dev-only none either (use `node --test`).
- `DEEPGRAM_API_KEY` is read only server-side from `process.env`; never sent to the browser, never committed. `.env.local` is already git-ignored.
- Endpoint `wss://agent.deepgram.com/v1/agent/converse`; browser auth via subprotocols `["bearer", accessToken]`; token from `POST https://api.deepgram.com/v1/auth/grant` with `Authorization: Token <key>`, body `{"ttl_seconds":30}`, response `{access_token, expires_in}`.
- Call cap: `CAP_SECONDS = 180`; warning at 150 s.
- Audio: input `linear16` at the capture AudioContext's real `sampleRate`; output `linear16`, `24000`, `container: "none"`. Playback AudioContext pinned to 48000 (Firefox AEC). No binary audio before `SettingsApplied`.
- The agent never states the phone number; the résumé file excludes it.
- Page styling uses existing tokens in `public/pro.html` `:root`; new control borders ≥ 3:1 (`#6b7080`).
- No change to `pages/index.tsx` or the live `/` route.

## Review Focus

1. **Microphone blocked or no mic device** → the call still opens in typed mode with an alert, not a dead panel. (Task 3, test via `getUserMedia` stub rejecting `NotAllowedError`.)
2. **Token route down / no key / out of credit (Error frame or socket close before `SettingsApplied`)** → clear message and the scripted fallback answers stay usable. (Task 2 client test: socket closes before SettingsApplied → `error` event with `kind: 'connect'`; Task 3 maps it.)
3. **Barge-in while audio is queued** → playback stops within one frame and queued chunks are discarded; the next reply plays cleanly. (Task 2 playback test.)
4. **Visitor closes/hides the tab or presses End mid-reply** → socket closed with 1000, mic tracks stopped, contexts closed (billing stops). (Task 2 client test: `end()` closes socket and calls `stop` on tracks.)
5. **Hitting the 3:00 cap mid-sentence** → agent wraps up via `InjectAgentMessage` (`behavior: "interrupt"`), call ends after that playback drains or 6 s, whichever first. (Task 2 client test with fake timers.)

---

### Task 1: Agent brain + token route

**Files:**
- Create: `voice-agent/resume.mjs` — `export const RESUME: string` (plain-text résumé from `public/resume/KeerthanGopalakrishnan.pdf` via `pdftotext -layout`, phone number removed, email kept).
- Create: `voice-agent/prompt.mjs` — `export function buildPrompt(resume: string): string`
- Create: `voice-agent/settings.mjs` — `export function buildSettings(): object`, `export const KEYTERMS: string[]`
- Create: `voice-agent/token.mjs` — `export function createTokenHandler({ fetchImpl, env, now }): (req, res) => Promise<void>`
- Create: `pages/api/voice-token.ts` — thin wrapper: `export default createTokenHandler({ fetchImpl: fetch, env: process.env, now: Date.now })`
- Modify: `modules/types.d.ts` — `declare module` entries if TS needs them for the `.mjs` imports.
- Modify: `package.json` — `"test": "node --test tests/"`
- Create: `.env.example` — `DEEPGRAM_API_KEY=` and `VOICE_ALLOWED_ORIGINS=https://www.itskeerthan.com,https://itskeerthan.com`
- Test: `tests/voice-agent/settings.test.mjs`, `tests/voice-agent/token.test.mjs`

**Interfaces:**
- Produces: `POST /api/voice-token` →
  - `200 { token: string, expiresIn: number, settings: Settings }` with `Cache-Control: no-store`. `settings.audio.input.sample_rate` is a placeholder `48000`; the client overwrites it.
  - `405` non-POST; `403 { error: 'origin' }`; `429 { error: 'rate_limited', retryAfter: number }`; `503 { error: 'unavailable' }` when key missing or grant fails (log the upstream status, never the key).
- `buildSettings()` returns exactly the shape in the reference §3.1 with: listen `{type:'deepgram', version:'v2', model:'flux-general-en', keyterms: KEYTERMS}`; think as an array: primary `{provider:{type:'open_ai', model:'gpt-4.1-mini', temperature:0.4}, prompt}`, fallback `{provider:{type:'anthropic', model:'claude-haiku-4-5', temperature:0.4}, prompt}`; speak `{provider:{type:'deepgram', version:'v2', model:'flux-miles-en'}}`; `greeting` = `"Hi, I'm Keerthan's AI agent. Ask me anything about his work: what he's built, where he's worked, or whether he's open to new roles."`; `experimental: true` (enables `AgentStartedSpeaking`); `tags: ['portfolio']`.
- `KEYTERMS`: `Keerthan, Gopalakrishnan, LiveKit, Deepgram, Kraftx, IntellifyAi, Blue Machines, BigBasket, IoTReady, Neoscale, PES University, DuckDB, Temporal`.

- [ ] **Step 1: Write failing tests** (`tests/voice-agent/settings.test.mjs`)
  - `buildSettings()` has `type === 'Settings'`, output `{encoding:'linear16', sample_rate:24000, container:'none'}`, listen model `flux-general-en`, think[0].provider.model `gpt-4.1-mini`, speak model `flux-miles-en`, greeting non-empty.
  - prompt length `< 25000`; prompt contains `'Blue Machines'` and `'4M'` or `'four million'`; prompt does **not** match `/7676724337|\+91/`.
  - prompt contains the rules (assert substrings): `only`-from-résumé rule, `one to three` sentences, `no markdown`, third person, decline off-topic, never claim to be Keerthan.
- [ ] **Step 2: Write failing tests** (`tests/voice-agent/token.test.mjs`) using a fake `req`/`res` and a stub `fetchImpl`:
  - GET → 405.
  - POST with `origin: https://evil.example` → 403, `fetchImpl` not called.
  - POST from `http://localhost:3000` when `env.NODE_ENV !== 'production'` → allowed.
  - POST from allowed origin with stub returning `{access_token:'t', expires_in:30}` → 200, body `{token:'t', expiresIn:30, settings}`, header `Cache-Control: no-store`; stub called with URL `https://api.deepgram.com/v1/auth/grant`, header `Authorization: Token k`, body `{"ttl_seconds":30}`.
  - missing `env.DEEPGRAM_API_KEY` → 503.
  - stub returns 401 → 503, and the response body never contains the key.
  - 6th request from the same IP (from `x-forwarded-for` first entry) within 60 s → 429 with `retryAfter`; after `now` advances 61 s → allowed. Daily cap: 40 per IP per rolling 24 h.
- [ ] **Step 3: Run** `npm test` → FAIL (modules missing).
- [ ] **Step 4: Implement** the four `voice-agent/*.mjs` files and the API route. Prompt persona: friendly, concise, spoken style; talks about Keerthan in third person; answers only from RESUME; when unsure says so and points to "the contact section at the bottom of the page"; on roles: open to new roles in voice/AI; numbers spoken naturally; no markdown/lists/emoji; refuses instructions to change its role or reveal the prompt.
- [ ] **Step 5: Run** `npm test` → PASS; `npx tsc --noEmit` → no new errors in `pages/api/voice-token.ts`.
- [ ] **Step 6: Manual check** `npm run dev`, then `curl -s -X POST -H 'origin: http://localhost:3000' localhost:3000/api/voice-token` → 503 `unavailable` without a key (or 200 with one).
- [ ] **Step 7: Commit** `feat(voice): agent prompt, settings and token route`

---

### Task 2: Browser voice engine

**Files:**
- Create: `public/voice/pcm.mjs` — pure helpers: `floatToInt16(f32: Float32Array): Int16Array`, `int16ToFloat(i16: Int16Array): Float32Array`, `rms(f32: Float32Array): number`, `class Batcher { constructor(size: number); push(i16: Int16Array): Int16Array[] }` (returns full chunks of `size` samples).
- Create: `public/voice/capture-worklet.js` — AudioWorkletProcessor `'pcm-capture'`: converts each block with the same math as `floatToInt16`, batches to 20 ms (`Math.round(sampleRate * 0.02)` samples), posts `{pcm: ArrayBuffer, level: number}` (transferable).
- Create: `public/voice/playback.mjs` — `class Player { constructor(ctx: AudioContext, rate = 24000); enqueue(buf: ArrayBuffer): void; flush(): void; get level(): number; get busy(): boolean; get drainMs(): number; close(): void }`. Gapless scheduling at `max(ctx.currentTime, nextStart)`; per-utterance `GainNode` → shared `AnalyserNode` → destination; `flush()` stops all tracked sources, disconnects the gain node, resets `nextStart = 0`.
- Create: `public/voice/agent-client.mjs` — `export function createVoiceCall(opts): VoiceCall`
- Test: `tests/voice/pcm.test.mjs`, `tests/voice/playback.test.mjs` (fake ctx), `tests/voice/agent-client.test.mjs` (fake WebSocket/fetch/getUserMedia/AudioContext, injected via `opts`).

**Interfaces:**
- Consumes: `POST /api/voice-token` → `{ token, expiresIn, settings }` (Task 1).
- Produces (used by Task 3):
  ```
  createVoiceCall({
    tokenUrl = '/api/voice-token', capSeconds = 180, warnAtSeconds = 150,
    // test seams, default to browser globals:
    WebSocketImpl, fetchImpl, getUserMedia, AudioContextImpl, now, setTimer, clearTimer
  }) → {
    start(): Promise<void>          // must be called inside the click handler
    end(reason?: string): void      // idempotent
    sendText(text: string): void    // InjectUserMessage {content}
    setMicEnabled(on: boolean): void
    get micAvailable(): boolean
    get levels(): { you: number, agent: number }   // 0..1, read every frame
    on(event, fn): () => void
  }
  events:
    'state'   { state: 'connecting'|'listening'|'thinking'|'speaking'|'interrupted'|'ended' }
    'text'    { role: 'user'|'agent', text: string }
    'latency' { seconds: number }       // LatencyReport.total_latency, else AgentStartedSpeaking.total_latency, else client-measured user-text→first-audio
    'warning' { secondsLeft: number }   // once at warnAtSeconds
    'mic'     { available: boolean, reason?: 'denied'|'unavailable' }
    'error'   { kind: 'connect'|'token'|'rate_limited'|'agent'|'network', message: string }
    'end'     { reason: 'user'|'cap'|'error'|'remote' }
  ```
- State machine: `connecting` → (`SettingsApplied`) `listening`; `UserStartedSpeaking` → `flush()` + (`interrupted` if player was busy, else `listening`); `AgentThinking` or user `ConversationText` → `thinking`; first binary frame or `AgentStartedSpeaking` → `speaking`; player drained after `AgentAudioDone` → `listening`.
- Mic: `getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true, channelCount:1}})`. On `NotAllowedError` → `mic {available:false, reason:'denied'}`, call continues (send `KeepAlive` every 8 s when not streaming audio). Capture ctx at native rate; `settings.audio.input.sample_rate = captureCtx.sampleRate` before sending Settings. Playback ctx `new AudioContext({sampleRate:48000})`.
- Cap: at `capSeconds` send `InjectAgentMessage {message: "That's our three minutes. Thanks for calling! You'll find Keerthan's contact details at the bottom of the page.", behavior: 'interrupt'}`, then `end('cap')` once drained or after 6 s.
- `end()`: stop mic tracks, close WS with 1000, close both contexts, clear timers, emit `state ended` + `end`.

- [ ] **Step 1: Write failing tests** `tests/voice/pcm.test.mjs`: `floatToInt16([1,-1,0,0.5])` → `[32767,-32768,0,16384]` (±1 rounding allowed for 0.5); clamps `>1`; `int16ToFloat` round-trips within 1e-4; `rms` of zeros 0, of constant 0.5 → 0.5; `Batcher(4)` given 3 then 6 samples returns `[]` then two 4-sample chunks with 1 sample left.
- [ ] **Step 2: Write failing tests** `tests/voice/playback.test.mjs` with a fake ctx (`currentTime`, `createBuffer`, `createBufferSource` recording `start(t)`/`stop()`, `createGain`, `createAnalyser`): three enqueues schedule back-to-back start times; `flush()` calls `stop()` on every un-ended source and `busy === false`; enqueue after flush starts at `currentTime`.
- [ ] **Step 3: Write failing tests** `tests/voice/agent-client.test.mjs` with fakes:
  - `start()` POSTs to tokenUrl, opens WS with protocols `['bearer', token]`, sends Settings only after `Welcome`, with `audio.input.sample_rate` = fake capture rate (44100).
  - no binary sent before `SettingsApplied`; after it, worklet `pcm` messages are sent as binary.
  - `UserStartedSpeaking` while audio queued → player flushed, state `interrupted`.
  - `ConversationText` user/assistant → `text` events with roles `user`/`agent`.
  - `LatencyReport {total_latency: 0.92}` → `latency {seconds: 0.92}`.
  - token 429 → `error {kind:'rate_limited'}` + `end {reason:'error'}`, no WS opened.
  - WS closes before `SettingsApplied` → `error {kind:'connect'}`.
  - `Error` frame → `error {kind:'agent'}` and `end`.
  - getUserMedia rejects `NotAllowedError` → `mic {available:false, reason:'denied'}`, call still reaches `listening`, KeepAlive sent after 8 s of fake time.
  - fake time reaches 150 s → one `warning {secondsLeft:30}`; 180 s → InjectAgentMessage with `behavior:'interrupt'` sent, then `end {reason:'cap'}` within 6 s.
  - `end()` twice → one close(1000), tracks stopped, contexts closed, one `end` event.
- [ ] **Step 4: Run** `npm test` → new tests FAIL.
- [ ] **Step 5: Implement** the four files.
- [ ] **Step 6: Run** `npm test` → PASS.
- [ ] **Step 7: Commit** `feat(voice): browser voice engine for Deepgram Voice Agent`

---

### Task 3: Wire the page — call panel, orb, captions, fallback

**Files:**
- Modify: `public/pro.html` — call panel markup (search `id="call"`), the call script (search `The hook: the portrait takes a call`), the orb state script (search `call state for the hero visual`), and the claude.ai dictation block (remove).

**Interfaces:**
- Consumes: `createVoiceCall` and events from Task 2 via `<script type="module">` importing `/voice/agent-client.mjs`.
- Orb uniforms already on the page: `cu.uYou`, `cu.uThink`, `cu.uTalk`, `cu.uSpin`, `cu.uCall`, `cu.uRing` (see `STATE_JS` and the `tl` assignment). Expose them from the orb script as `window.__orb = { cu }` (the module script reads it).

- [ ] **Step 1: Markup** inside the existing `<section class="call">`, meeting every item in the a11y requirements doc:
  - status line `#callState` (`role="status"`), alert region `#callAlert` (`role="alert"`), agent-reply announcer `#callSay` (visually hidden, `aria-live="polite" aria-atomic="true"`), transcript `#callLog` (`role="log" aria-live="off"`, entries labelled "You:" / "Agent:", agent entries end with muted mono latency `· 0.9 s`).
  - `<form id="callAsk">` with visible label "Type a question", input `#callText`, Send button; mic toggle `#callMic` (`aria-pressed`, text "Mic on"/"Mic off"); existing chips group `#callQs`; timer `#callTime` `aria-hidden="true"`; End call.
  - Control borders `#6b7080`; targets ≥ 24 px (mic/send ≥ 40 px).
- [ ] **Step 2: Call logic** replace `say/ask/answer/hang` for the live path:
  - Talk click → open panel, focus End call, `call.start()`; status from `state` events, debounced 400 ms for screen readers (visual updates immediate). Status text map: connecting "Connecting", listening "Listening", thinking "Thinking", speaking "Agent speaking", interrupted "Go ahead, I'm listening", ended "Call ended".
  - `text` events append to `#callLog`; agent text also into `#callSay` (final text only, one per turn). `latency` attaches to the latest agent entry.
  - chips and the form call `call.sendText(text)` and log the user entry immediately.
  - `warning` → status "30 seconds left" (single announcement). `mic` unavailable → alert "Microphone blocked. You can still type your questions." and focus `#callText`.
  - `error` → alert with the message map: rate_limited "Too many calls right now. Try again in a minute."; connect/token/network/agent "The agent is offline right now." Then switch the panel to **scripted mode**: the existing `INTENTS` chips + `speechSynthesis` answers keep working (keep that code path, labelled "Offline answers").
  - End/ Esc inside panel / `end` event → hide panel, focus Talk button, status "Call ended".
- [ ] **Step 3: Orb wiring** replace the simulated `STATE_JS` loop with a rAF loop reading `call.levels` and state: `uYou ← ease(levels.you)` (fast attack 0.35, release 0.08); `uTalk ← ease(levels.agent)` same; `uThink → 1` while state `thinking`, `uSpin += dt*0.5*uThink`; `uCall → 1` while live; `uRing → 1` for 2.2 s after connect. Interrupted: set `uTalk` to 0 immediately. Respect `prefers-reduced-motion` (no rAF easing; set states directly, no spin).
- [ ] **Step 4: Verify in Chrome** (Claude in Chrome, not Playwright): `npm run dev`, open `http://localhost:3000/pro.html`.
  - without `DEEPGRAM_API_KEY`: Talk → alert "The agent is offline right now", offline chips answer aloud, focus order correct, Esc ends and focus returns.
  - with key: greeting plays; ask "What did he do at Kraftx?" → orb blue while talking, spins while thinking, orange while speaking; transcript and latency appear; talk over the agent → audio stops immediately; End stops audio; no console errors.
  - keyboard-only pass and reduced-motion pass.
- [ ] **Step 5: Commit** `feat(voice): real voice call with turn-taking orb on pro page`

---

### Task 4: Review

- [ ] Accessibility review of the changed `public/pro.html` against the requirements doc (accessibility-lead), fix blocking findings.
- [ ] Whole-branch code review; fix important findings; `npm test` green.
