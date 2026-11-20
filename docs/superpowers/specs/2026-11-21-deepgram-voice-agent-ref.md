# Deepgram Voice Agent API: implementation reference (as of 2026-11-21)

Sources: Deepgram's official docs (raw markdown pulled from `https://developers.deepgram.com/<path>.md`). The AsyncAPI spec is at `https://developers.deepgram.com/reference/voice-agent/voice-agent.md`. I also read the official npm packages `@deepgram/agents@0.2.0` (2026-10-21) and `@deepgram/sdk@5.20.0` (2026-11-12), the official repos `deepgram/browser-agent` and `deepgram-starters/voice-agent-html`, and the live endpoint `GET https://agent.deepgram.com/v1/agent/settings/think/models`.
Anything not confirmed from one of these sources is marked **[UNVERIFIED]**.

> **Big changes since mid-2025, so don't rely on older memory:**
> - **Flux TTS is now the default `speak` provider.** It uses `version: "v2"` and model `flux-kit-en`. If you omit `agent.speak`, you get Flux TTS.
> - **Flux STT is the recommended listen model.** It uses `version: "v2"` and model `flux-general-en`.
> - **`agent.language` is deprecated.**
> - **There are new messages:** `FunctionCallCancelled`, `ForceEndTurn`, `UpdateListen`, `UpdateThink`, `LatencyReport`, `History`, `InjectionRefused` and the Think Live messages.
> - **The OpenAI and Anthropic model lists have changed.**

---

## 1. Endpoint, version, connection flow

- **URL:** `wss://agent.deepgram.com/v1/agent/converse`. The API version is `v1` and sits in the path; the AsyncAPI title is `agent.v1`. The SDK's environment constant is `agent: "wss://agent.deepgram.com"` plus `urlPath: "/v1/agent/converse"`.
- **Regional hosts** exist for the EU, AU and IN regions. See `/reference/regional-endpoints`. The default (North America) host is used here.
- **No query parameters are needed.** All configuration goes in the first JSON `Settings` message.
- **Text frames** carry JSON control messages. **Binary frames** carry raw audio in both directions. Set `ws.binaryType = "arraybuffer"`.

### Sequence

This is from `/docs/voice-agent-message-flow`:

1. Open the WebSocket with auth (see section 2).
2. The server sends `{"type":"Welcome","request_id":"<uuid>"}`. **Send nothing before this.**
3. The client sends **one** `Settings` JSON message.
   - A second `Settings` causes Error `SETTINGS_ALREADY_APPLIED`.
   - Any other message sent first causes Error `NON_SETTINGS_MESSAGE_BEFORE_SETTINGS`.
4. The server sends `{"type":"SettingsApplied"}`. **Send no audio and no inject messages before this.** The official SDK buffers mic frames until this arrives, then flushes them.
5. The client streams binary mic audio continuously.
6. If `agent.greeting` is set, the agent speaks it right away. You get `ConversationText` (role `assistant`), then binary audio frames, then `AgentAudioDone`. **This is your "first audio".**
7. A typical turn then runs:
   1. `UserStartedSpeaking`
   2. `ConversationText` (role `user`)
   3. `AgentThinking` (optional)
   4. `ConversationText` (role `assistant`)
   5. binary audio
   6. `AgentAudioDone`
   7. `History` and `LatencyReport` may also arrive.
8. **Session limits:**
   - Max session length is **2 hours**.
   - `Warning` `MAXIMUM_SESSION_LENGTH_APPROACHING` arrives at 1h55m.
   - `Error` `MAXIMUM_SESSION_LENGTH_REACHED` arrives at 2h.
   - Deepgram has **no shorter server-side limit you can configure.** You must enforce the 3-minute cap yourself (see 2.4).

---

## 2. Authentication from the browser

### 2.1 WebSocket subprotocol auth (confirmed in the official SDK source)

Browsers can't set `Authorization` on a WebSocket. Deepgram accepts the credential in `Sec-WebSocket-Protocol`, as **two array entries**. The source is `@deepgram/sdk` `dist/cjs/CustomClient.js`; the comment there says `Deepgram expects: For API keys: Sec-WebSocket-Protocol: token,API_KEY ... For Bearer tokens: Sec-WebSocket-Protocol: bearer,TOKEN`.

```js
// temporary JWT from /v1/auth/grant  (what you want)
new WebSocket("wss://agent.deepgram.com/v1/agent/converse", ["bearer", jwt]);
// raw API key  (NEVER in a browser in production)
new WebSocket("wss://agent.deepgram.com/v1/agent/converse", ["token", apiKey]);
```

- `deepgram/browser-agent` (the official web component) does `new WebSocket(url, [scheme, token])` with `scheme` defaulting to `"bearer"`.
- The docs page `/docs/browser-agent-overview` says: "The SDK works around this by passing the token as a `Sec-WebSocket-Protocol` value."
- Note: `deepgram-starters/voice-agent-html` uses `["access_token.<token>"]`. That form is for **its own backend proxy**, not Deepgram. Don't copy it.
- There is also an optional extra protocol pair, `"x-deepgram-session-id", <id>`, which the SDK supports.

### 2.2 Temporary tokens (the grant endpoint)

From `/reference/auth/tokens/grant` and `/guides/fundamentals/token-based-authentication`:

- **Request:**
  ```
  POST https://api.deepgram.com/v1/auth/grant
  Authorization: Token <DEEPGRAM_API_KEY>
  Content-Type: application/json

  {"ttl_seconds": 30}      // optional; body may be {}
  ```
- **Response 200:** `{"access_token": "<JWT>", "expires_in": 30}`
- **TTL:**
  - The default is **30 s**. The max is **3600 s**.
  - The field is `ttl_seconds`. An unknown field such as `ttl` is silently ignored and you get 30 s.
- **Scope:** the token has `usage::write` and works for `/listen`, `/speak`, `/read` and the **`/agent` WebSocket**. It does not work for Management APIs. **Confirmed: it works for the agent endpoint.**
- **Key permissions:** the key that mints tokens needs **Member** role or higher. With less you get `403 {"err_code":"FORBIDDEN","err_msg":"Insufficient permissions."}`.
- **Usage attribution:** tokens carry the same accessor as the minting key.
- **Rate limits:** grant tokens are unlimited. Programmatically created API keys are limited to 250 per day.
- **Next.js 12 API route (Node 16+/18).** This is a sketch only, not project code:
  ```js
  const r = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 30 }),
  });
  const { access_token, expires_in } = await r.json();
  ```

### 2.3 Does the token TTL bound how long the socket stays open?

**No.** The official FAQ says: "You only need the temporary token to be valid during the initial websocket connection... The websocket connection will then stay open as it would in any other case until you close it." The Browser Agent docs add: "the 30-second default comfortably sustains an hour-long call."

So the TTL limits **connect time only**. A socket opened with a valid token can live up to the 2-hour session maximum.

### 2.4 Capping spend and duration

- **Key scoping.** Project roles are `owner`, `admin` and `member`. `member` includes `project:read project:write keys:read keys:write (own keys) usage:read usage:write`.
  - No narrower "agent-only" or "usage-only" role is documented. **[UNVERIFIED that none exists]**
  - Use a `member` key on the server. Keys can also get `time_to_live_in_seconds` or `expiration_date` via `POST /v1/projects/{project_id}/keys`.
- **Project spend caps.** I found **no documented per-project spend or usage limit setting**. **[UNVERIFIED]**
  - The only built-in limit is the **balance itself** (see section 7) and concurrency.
  - Pay as you go Voice Agent concurrency is **up to 45 concurrent connections per project**. This is per project, not per key. Secondary projects on self-serve accounts get **1 concurrent stream**.
  - One option: put the site on its own project with a limited balance. **[UNVERIFIED that credits can be moved freely; the docs say promo credit is attached to the first project and moving it needs Support]**
- **Enforcing 3 minutes.** Deepgram can't do this for you.
  - **Client side:** start a timer at `SettingsApplied`. At about 2:45, send `InjectAgentMessage` with a goodbye line. At 3:00, call `ws.close()`.
  - **Server side:** your API route can only limit *how often* it mints tokens (per IP/session rate limit, short TTL such as 30 s). A malicious user holding a token could keep a socket open up to 2 h, about $9 at the Standard rate. Rate-limit the token route accordingly.

---

## 3. `Settings` message schema

Required fields come from the AsyncAPI spec. "Req" means required.

### Top level

| Field | Req | Type / values | Notes |
|---|---|---|---|
| `type` | **yes** | `"Settings"` | |
| `audio` | **yes** | object | |
| `agent` | **yes** | object **or** a UUID string | The UUID form refers to a stored [Reusable Agent Configuration](https://developers.deepgram.com/docs/reusable-agent-configurations). Stored configs are visible to all project members. |
| `tags` | no | string[] | For usage filtering |
| `experimental` | no | bool, default `false` | **`AgentStartedSpeaking` is only sent when this is `true`** (per spec) |
| `mip_opt_out` | no | bool, default `false` | Opts out of the Model Improvement Program |
| `flags.history` | no | bool, default `true` | Turns `History` messages on or off |

### `audio.input`

If `audio.input` is present, `encoding` and `sample_rate` are both required.

- **`encoding`:** one of `linear16` (default), `linear32`, `flac`, `alaw`, `mulaw`, `amr-nb`, `amr-wb`, `opus`, `ogg-opus`, `speex`, `g729`.
- **`sample_rate`:** an integer in Hz. The spec says "Common values are 16000, 24000, 44100, 48000".
- **The docs disagree on the default.** The AsyncAPI spec says "If omitted, defaults to encoding=linear16 and sample_rate=24000". The Configure page says 16000. **Always set it explicitly.**

### `audio.output`

| Field | Values |
|---|---|
| `encoding` | `linear16` (default), `mulaw`, `alaw`, `mp3`, `opus`, `flac`, `aac` |
| `sample_rate` | integer |
| `bitrate` | integer |
| `container` | `none` (default), `wav`, `ogg` |

**With Flux TTS (`speak.provider.version: "v2"`):**
- Only `linear16`, `mulaw` and `alaw` are accepted. `container` must be `none`, and `bitrate` is not accepted.
- `linear16` sample rates: `8000`, `16000`, `24000` (default), `32000`, `44100`, `48000`.
- Compressed encodings or a `wav` container cause `INVALID_SETTINGS`.

**Recommendation:** use `{"encoding":"linear16","sample_rate":24000,"container":"none"}`.

### `agent`

| Field | Req | Notes |
|---|---|---|
| `agent.language` | no | **Deprecated** (default `en`). Don't send it; language lives in the model names. |
| `agent.greeting` | no | String spoken at the start |
| `agent.context.messages[]` | no | Prior history: `{type:"History",role:"user"|"assistant",content}` or `{type:"History",function_calls:[...]}` |
| `agent.listen.provider` | – | See below |
| `agent.think` | – | Object, **or an array of objects** for fallbacks. Each needs `provider`. |
| `agent.speak` | – | Object, **or an array** for fallbacks. Each needs `provider`. If omitted, it defaults to Flux TTS `flux-kit-en`. |
| `agent.think_live` | no | Think Live (backchannels, fillers). Not needed here. |

### `agent.listen.provider`

`type: "deepgram"` is required. There are two shapes.

**Flux STT (`version: "v2"`, recommended):**
- `model` is **required**: `flux-general-en` or `flux-general-multi`.
- `keyterms`: string[]. Use plain strings with no `:weight`. Put a multi-word phrase in one element.
- `eot_threshold`: 0.5–1.0, default 0.7. Setting `1.0` turns off natural end-of-turn detection.
- `eager_eot_threshold`: 0.3–0.9, must be ≤ `eot_threshold`. It opens a "speculative window" that cuts latency.
- `eot_timeout_ms`: default 5000.
- `smart_format` is **not allowed** with Flux STT.
- `ForceEndTurn` only works with Flux STT.

**Nova (`version: "v1"`, the default when omitted):**
- `model` is for example `nova-3` or `nova-2`.
- `language`: the spec says default `en-US`; the docs say Nova defaults to `en`.
- `keyterms`: string[].
- `smart_format`: bool, default false.

**Example:**
```json
"listen": { "provider": { "type": "deepgram", "version": "v2", "model": "flux-general-en",
                          "keyterms": ["<Person Name>", "<Employer>", "Kubernetes"] } }
```

### `agent.think`

- **`provider.type`** is one of `open_ai`, `anthropic`, `google`, `groq`, `nvidia`, `aws_bedrock` or `deepgram`. `provider.model` is required for managed models.
- **`provider.temperature`** is 0–2 (OpenAI, Google, Groq, Deepgram) or 0–1 (Anthropic).
- **`provider.reasoning_mode`** is one of `none`, `minimal`, `low`, `medium`, `high`. It applies to OpenAI reasoning models (gpt-5 family and later).
- **`prompt`** is the system prompt. **Max 25,000 characters for managed LLMs** (unlimited for BYO). If it's too long it gets truncated, with Warning `PROMPT_TOO_LONG`.
- **`functions[]`** each have `name`, `description`, `parameters` (JSON Schema), optional `endpoint` (makes it server-side), and optional `defer_until_eot` (bool).
- **`endpoint`** `{url, headers}` is for BYO only. **Omit it for managed models.**
- **`context_length`** only applies with a custom endpoint.

**Deepgram-managed models at the Standard pricing tier** (`/docs/voice-agent-llm-models`, fetched today). Standard-tier models are covered by the one Standard per-minute price:

| `type` | Standard-tier models |
|---|---|
| `open_ai` | `gpt-5.6-luna`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5-mini`, `gpt-5-nano`, `gpt-4.1-mini`, `gpt-4.1-nano`, `gpt-4o-mini` |
| `anthropic` | `claude-haiku-4-5`, `claude-3-5-haiku-latest` |
| `google` | `gemini-3.5-flash`, `gemini-3.1-flash-lite`, `gemini-3-flash-preview`, `gemini-2.5-flash`, `gemini-2.0-flash-lite` (uses `version`: `ai-studio-v1beta` or `gemini-enterprise-agent-v1`) |
| `nvidia` | `nemotron-3-nano-30B-A3B` |
| `groq` | `openai/gpt-oss-20b` (this needs `endpoint`, so it's BYO, not managed) |

**Advanced-tier models (higher price):**
- `open_ai`: `gpt-4o`, `gpt-4.1`, `gpt-5`, `gpt-5.1`, `gpt-5.2`, `gpt-5.4`, `gpt-5.5`, `gpt-5.6-terra`, and the `*-chat-latest` models.
- `anthropic`: `claude-sonnet-4-5`, `claude-sonnet-4-6`, `claude-sonnet-5`, and `claude-sonnet-4-20250514` (deprecated).
- `google`: `gemini-3-pro-preview`.

**Live model list.** The unauthenticated `GET https://agent.deepgram.com/v1/agent/settings/think/models` returned these ids today (no tier info):
- **Present but not in the docs table:** `claude-haiku-5-5`, `claude-sonnet-5-5`, `gpt-6-luna`, `gemini-3.8-flash`, `gemini-2.5-flash-lite`, `gemini-3.1-pro-preview`, `nvidia/nemotron-3.5-lightning-30b-a3b`.
- **Missing from the live list:** `claude-3-5-haiku-latest` and `nemotron-3-nano-30B-A3B`. Avoid those two.
- **Tiers for the new ids are [UNVERIFIED].**

**Safe Standard picks:** `{"type":"open_ai","model":"gpt-4.1-mini"}`, `gpt-4o-mini`, or `{"type":"anthropic","model":"claude-haiku-4-5"}`.

The `deepgram` provider (`think-fast`, `phonellm-mini-alpha-2-fp8`) is Early Access and for contract customers only. Don't use it.

### `agent.speak.provider`

- **Deepgram Flux TTS (default):**
  - `{"type":"deepgram","version":"v2","model":"flux-<voice>-en"}`
  - Optional `speed` is 0.5–1.5 in 0.05 steps. Optional `expressivity` is −2..2 (beta; 0 recommended).
  - **Do not send `language`** to Deepgram voices; it causes `UNPARSABLE_CLIENT_MESSAGE`.
- **Deepgram Aura-2:** `{"type":"deepgram","version":"v1","model":"aura-2-<voice>-en"}`. Optional `speed` is 0.7–1.5.
- **Others:** `cartesia` is managed and included in Standard. Third-party providers (`eleven_labs`, `open_ai`, `aws_polly`) need `endpoint` and their own keys.

**Good English voices.** You can audition them at talk.deepgram.com.

| Family | Female | Male |
|---|---|---|
| Flux TTS (`v2`) "featured" | `flux-alexis-en` (US, adult, professional/calm), `flux-sienna-en` (US, warm), `flux-haley-en` (US), `flux-hannah-en` (US, young), `flux-brooke-en` (US), `flux-gemma-en` (UK) | `flux-miles-en` (US, adult, calm/professional), `flux-cliff-en` (US, mature, deep), `flux-cole-en` (US, young), `flux-kit-en` (UK, default), `flux-colin-en` (UK, warm/authoritative), `flux-sean-en` (UK, mature) |
| Aura-2 (`v1`) | `aura-2-thalia-en`, `aura-2-asteria-en`, `aura-2-athena-en`, `aura-2-luna-en`, `aura-2-helena-en`, `aura-2-andromeda-en`, `aura-2-harmonia-en`, `aura-2-vesta-en`, `aura-2-pandora-en` (UK) | `aura-2-apollo-en`, `aura-2-arcas-en`, `aura-2-orion-en`, `aura-2-orpheus-en`, `aura-2-zeus-en`, `aura-2-hermes-en`, `aura-2-odysseus-en`, `aura-2-mars-en`, `aura-2-draco-en` (UK) |

**Whether Flux STT and Flux TTS fall within the "Standard" Voice Agent price:** the pricing page says one rate covers "speech-to-text, a managed language model, and text-to-speech", and Flux is the documented default. But no page explicitly maps Flux models to Standard. **[UNVERIFIED]**

### 3.1 Complete example `Settings` (résumé Q&A, English, browser)

```json
{
  "type": "Settings",
  "tags": ["resume-site"],
  "mip_opt_out": true,
  "audio": {
    "input":  { "encoding": "linear16", "sample_rate": 48000 },
    "output": { "encoding": "linear16", "sample_rate": 24000, "container": "none" }
  },
  "agent": {
    "listen": {
      "provider": {
        "type": "deepgram",
        "version": "v2",
        "model": "flux-general-en",
        "keyterms": ["<Full Name>", "<Company A>", "<University>"],
        "eot_threshold": 0.7,
        "eot_timeout_ms": 5000
      }
    },
    "think": {
      "provider": { "type": "open_ai", "model": "gpt-4.1-mini", "temperature": 0.4 },
      "prompt": "You are a friendly voice assistant that answers questions about <Full Name>'s résumé. Answer only from the RÉSUMÉ below; if something isn't in it, say you don't know. Keep answers to one to three short spoken sentences. No markdown, lists, or emoji. Spell out numbers and abbreviations naturally.\n\nRÉSUMÉ:\n<... résumé text, keep total prompt < 25,000 chars ...>"
    },
    "speak": {
      "provider": { "type": "deepgram", "version": "v2", "model": "flux-alexis-en" }
    },
    "greeting": "Hi! Ask me anything about <First Name>'s experience, projects, or skills."
  }
}
```

Notes on this example:
- **`sample_rate: 48000` must equal your capture `AudioContext.sampleRate`.** Read it at runtime; it can be 44100. Alternatively, resample to 16000 and declare 16000.
- **Fallbacks:** to survive a provider outage, `think` and `speak` may be arrays. For example: `"think": [ {provider:{type:"open_ai",model:"gpt-4.1-mini"}, prompt:"..."}, {provider:{type:"anthropic",model:"claude-haiku-4-5"}, prompt:"..."} ]`.

---

## 4. Message catalogue (exact `type` strings)

### Server → client (text frames)

| `type` | Payload fields |
|---|---|
| `Welcome` | `request_id` (string). Sent immediately on open. |
| `SettingsApplied` | (none) |
| `ConversationText` | `role`: `"user"` or `"assistant"`; `content`; `conversational_behavior`: `default`, `backchannel`, `presence_check` or `filler` (always `default` without Think Live). Flux multi also sends `languages_hinted` and `languages`. |
| `UserStartedSpeaking` | (none). **Barge-in signal.** |
| `AgentThinking` | `content` (string) |
| `AgentStartedSpeaking` | `total_latency`, `tts_latency`, `ttt_latency` (floats). **Only sent when `experimental: true`.** |
| `AgentAudioDone` | (none). Sent after the last audio chunk of an utterance. Local playback may still be running. |
| `FunctionCallRequest` | `functions: [{id, name, arguments (JSON string), client_side (bool), thought_signature?}]` |
| `FunctionCallResponse` | `id?`, `name`, `content`. The server echoes this when it ran a server-side function. |
| `FunctionCallCancelled` | `functions: [{id, name}]`. Don't respond to these ids. |
| `PromptUpdated` / `SpeakUpdated` / `ThinkUpdated` / `ListenUpdated` / `ThinkLiveUpdated` | (none). These acknowledge `Update*` messages. |
| `InjectionRefused` | `message` (string) |
| `History` | `{role, content}` **or** `{function_calls:[{id,name,client_side,arguments,response,thought_signature?}]}`. Turn off with `flags.history:false`. |
| `LatencyReport` | All optional floats in seconds: `stt_latency`, `ttt_token_latency`, `ttt_text_latency`, `ttt_tool_latency`, `ttt_thinking_latency`, `tts_latency`, `total_latency` |
| `FrustrationDetected` | `count`, `escalated` (Think Live only) |
| `Error` | `description`, `code`. **Fatal:** treat the session as over. |
| `Warning` | `description`, `code`. Non-fatal. |
| `__customFromThinkProvider` | Experimental, BYO wss think only |

Binary frames from the server are raw TTS audio in `audio.output` format. With `linear16` + `none`, that is headerless little-endian signed 16-bit mono PCM.

**Error codes:**
- `INTERNAL_SERVER_ERROR`
- `CLIENT_MESSAGE_TIMEOUT`
- `UNPARSABLE_CLIENT_MESSAGE`
- `NON_SETTINGS_MESSAGE_BEFORE_SETTINGS`
- `SETTINGS_ALREADY_APPLIED`
- `INVALID_SETTINGS`
- `FAILED_TO_START_LISTENING`
- `ASR_CONNECTION_CLOSED`
- `ASR_DRIVER_TIMEOUT`
- `USER_AUDIO_FORMAT`
- `FAILED_TO_SPEAK`
- `SERVER_GOING_AWAY`
- `NON_EXISTENT_FUNCTION_CALLED`
- `AGENT_ID_NOT_SUPPORTED`
- `INVALID_AGENT_ID`
- `FAILED_TO_THINK`
- `MAXIMUM_SESSION_LENGTH_REACHED`

**Warning codes:**
- `INJECT_AGENT_MESSAGE_DURING_USER_SPEECH`
- `INJECT_AGENT_MESSAGE_DURING_AGENT_SPEECH`
- `PROMPT_TOO_LONG`
- `THINK_REQUEST_FAILED`
- `SPEAK_REQUEST_FAILED`
- `FUNCTION_CALL_FAILED`
- `SLOW_THINK_REQUEST`
- `SLOW_SPEAK_REQUEST`
- `FORCE_END_TURN_UNSUPPORTED`
- `GPT_4O_STREAM_END_ERROR`
- `MAXIMUM_SESSION_LENGTH_APPROACHING`
- `THINK_MODEL_MIP_OPT_OUT_UNSUPPORTED`
- (`VOICE_PROMPT_ADDED` and `DYNAMIC_FILLER_UNAVAILABLE` only apply to the Deepgram LLM and Think Live)

### Client → server

| `type` | Shape |
|---|---|
| `Settings` | See section 3 |
| `KeepAlive` | `{"type":"KeepAlive"}`. Only needed while **not** sending audio: one every **8 s**. No reply. It doesn't extend the 2 h limit. The official SDK sends one every 10 s regardless. |
| `InjectUserMessage` | `{"type":"InjectUserMessage","content":"..."}` (text input as if the user spoke it) |
| `InjectAgentMessage` | `{"type":"InjectAgentMessage","message":"...","behavior":"default"\|"queue"\|"interrupt"}`. **The field is `message`, not `content`.** With `default`, it's refused (`InjectionRefused`) if anyone is mid-turn. |
| `UpdatePrompt` | `{"type":"UpdatePrompt","prompt":"..."}`. This **appends** to the current prompt; it doesn't replace it. Reply: `PromptUpdated`. |
| `UpdateSpeak` | `{"type":"UpdateSpeak","speak":{"provider":{...}}}`. Reply: `SpeakUpdated`. |
| `UpdateThink` | `{"type":"UpdateThink","think":{...}}`. Replaces the whole think config. Reply: `ThinkUpdated`. |
| `UpdateListen` | `{"type":"UpdateListen","listen":{"provider":{...}}}`. Reply: `ListenUpdated`. |
| `UpdateThink_Live` | `{"type":"UpdateThink_Live","think_live":{...}}` (note the underscore) |
| `FunctionCallResponse` | `{"type":"FunctionCallResponse","id":"<from request>","name":"...","content":"<string>"}` |
| `ForceEndTurn` | `{"type":"ForceEndTurn"}`. Flux STT (v2) only. |
| `__customToThinkProvider` | Experimental |
| *(binary)* | Mic audio in `audio.input` format |

**Timeout:** if you stop sending audio and don't send `KeepAlive`, you get `CLIENT_MESSAGE_TIMEOUT`.

---

## 5. Barge-in

- **When the user starts talking**, the server sends `{"type":"UserStartedSpeaking"}`. This also happens when the user talks over the agent.
- **The docs say:** "If the client is playing agent audio when this message is received, it should **stop playback immediately and discard all of its buffered agent audio**."
- **The server stops generating and sending** the rest of the interrupted reply. In-flight LLM work for that reply is dropped.
- **Pending function calls:** client-side calls you already received for the dropped reply are cancelled with `FunctionCallCancelled`. Don't answer those.
- **Speculative replies:**
  - The agent may start the LLM before the turn is confirmed.
  - **TTS audio and the user's `ConversationText` are held until confirmation.** So a resumed turn just produces another `UserStartedSpeaking`, with no stray audio.
  - Function calls are *not* held unless `defer_until_eot: true` is set.
- **What the client must do:**
  - Stop every scheduled `AudioBufferSourceNode`, or `close()` the playback `AudioContext`. The official `AgentPlayer.interrupt()` closes the context and resets `nextStartTime = 0`.
  - Clear any queue.
  - Keep streaming mic audio.
  - Don't pause the mic during agent speech unless echo is a problem.
- **Partial transcripts:** the assistant `ConversationText` you already displayed may include words that were never spoken. The docs don't say whether it's truncated. **[UNVERIFIED]**
- **`AgentAudioDone` is not "user heard it".** To know when playback ends (e.g. for an "agent speaking" UI or before closing at 3:00), track your own queue: `nextStartTime - ctx.currentTime`.

---

## 6. Browser audio handling

### What the official code does

- **`@deepgram/agents` `AgentMicrophone`:**
  - Calls `getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true}})`.
  - Creates `new AudioContext({sampleRate: 16000})` and calls `resume()`.
  - Runs an inline **AudioWorklet** (loaded from a Blob URL) that converts each 128-frame Float32 block to Int16 (`s<0 ? s*0x8000 : s*0x7fff`) and `postMessage`s it.
  - Sends **each 128-sample block as its own WebSocket message** (8 ms at 16 kHz).
  - Declares input `linear16` @ 16000.
- **`AgentPlayer`:**
  - Uses `new AudioContext({sampleRate: 24000})`.
  - For each binary chunk, it converts Int16 to Float32 (`/32768` or `/32767`), calls `createBuffer(1, n, 24000)`, and plays it with an `AudioBufferSourceNode` at `max(ctx.currentTime, nextStartTime)` for gapless scheduling.
  - `interrupt()` calls `ctx.close()`.
- **`deepgram/browser-agent`:**
  - Plays TTS through an AudioContext pinned to **48000**, with the comment "stick to 48000 to keep echo cancellation working in Firefox".
  - The mic context uses the default rate.
  - It uses `ScriptProcessorNode(4096)`, which is deprecated.

### Recommendations for a no-bundler ES-module page

- **Capture.** Use an AudioWorklet; ScriptProcessor is deprecated. There are two valid choices:
  - **(a) Native rate (simplest, most robust).**
    - Create `new AudioContext()` with no `sampleRate`.
    - Convert to Int16 in the worklet and declare `audio.input.sample_rate = ctx.sampleRate` (48000 or 44100).
    - Bandwidth is about 96 KB/s.
  - **(b) 16 kHz.**
    - `new AudioContext({sampleRate:16000})` is what the official SDK does. Chrome and Safari resample the mic.
    - Older Firefox versions threw on `createMediaStreamSource` across mismatched rates. **[UNVERIFIED for current Firefox]**
    - Or keep the native rate and downsample in the worklet with a low-pass filter. Naive decimation, as in `voice-agent-html`, aliases.
  - Accuracy at 16 k versus 48 k: the docs don't claim a difference for STT. The spec says "Higher sample rates like 44100 Hz provide better audio quality."
- **Chunk size.** The docs don't specify one. **[UNVERIFIED]** The official SDK sends 128-frame chunks with no batching. Batching to **20–100 ms** per message (e.g. 960–4800 samples at 48 k) cuts message overhead and is a common practice.
- **Constraints.** Use `echoCancellation: true` (essential with laptop speakers). Also set `noiseSuppression: true` and `autoGainControl: true` (official SDK defaults), and `channelCount: 1`. Browsers may ignore the `sampleRate` constraint.
- **Playback.**
  - Request output `linear16` @ **24000** (the Flux TTS default), `container: "none"`.
  - Play it via `AudioBufferSourceNode` scheduling as described above. An AudioBuffer at 24 kHz plays fine in a 48 kHz context because the browser resamples.
  - Use a separate playback context or the same one. To keep Firefox AEC happy, the official component uses a 48 k playback context.
  - **Don't** use `<audio>`/`decodeAudioData` on raw chunks. Headerless PCM won't decode. The docs' WAV-header advice is only for that path.
- **Endianness.** `new Int16Array(arrayBuffer)` assumes platform endianness, which is little-endian on all real browsers. Deepgram `linear16` is little-endian.
- **Echo ("agent hears itself").** The docs list these mitigations:
  1. Mute the mic programmatically.
  2. Use local VAD gating.
  3. Use `echoCancellation: true`.
  4. Use headphones.

  Chrome's AEC only cancels audio played through the same WebRTC/WebAudio output path. **[UNVERIFIED nuance]**
- **Safari / iOS.** None of this is in Deepgram's docs; it is standard Web Audio behaviour. **[UNVERIFIED]**
  - Create or `resume()` every AudioContext **inside the click handler** that starts the call.
  - Call `getUserMedia` from a user gesture.
  - iOS may force 48 kHz hardware and ignore the `sampleRate` option on old versions, so always read `ctx.sampleRate`.
  - Use `window.AudioContext || window.webkitAudioContext`.
  - Closing and recreating contexts on barge-in is fine on iOS, but recreate it in a way that stays "unlocked". Alternative: keep one context and `stop()` all tracked sources plus disconnect a per-utterance `GainNode`.
- **Worklet loading without a bundler.** `audioWorklet.addModule('/path/worklet.js')` or a Blob URL (the official SDK uses a Blob URL). A CSP must allow `blob:` for that.
- **Pre-Settings audio.** Don't send binary frames until `SettingsApplied`. Buffer them or drop them.
- **End of call.**
  - Stop the mic tracks (`track.stop()`) and close the contexts.
  - `ws.close(1000)`. There is no special close message; `Close` in the diagram is just the WS close.
  - **Billing stops when the socket closes**, because billing is on connection time.

### Optional: official SDK via CDN

`@deepgram/agents` (ESM, depends on `@deepgram/sdk` and `eventemitter3`) could be imported via `https://cdn.jsdelivr.net/npm/@deepgram/agents@0.2.0/+esm`. **[UNVERIFIED that jsDelivr's +esm bundling of @deepgram/sdk works in-browser]** The drop-in widget is `https://cdn.deepgram.com/widgets/latest/widget.umd.js`, which needs an Agent ID and a `tokenFactory`. A hand-rolled `WebSocket` is about 150 lines and avoids the dependency.

---

## 7. Billing

From `https://deepgram.com/pricing`, fetched 2026-11-21:

- **Rates (Pay as you go / Growth):**

  | Tier | Pay as you go | Growth |
  |---|---|---|
  | **Standard** | **$0.075/min** | $0.068/min |
  | Standard, BYO TTS | $0.056/min | |
  | Custom, BYO LLM | $0.065/min | |
  | BYO LLM+TTS | $0.050/min | |
  | Advanced | $0.163/min | |
  | Advanced, BYO TTS | $0.122/min | |

  The tier is chosen by the LLM's tier (section 3).
- **Billing basis:** "Calculated on **WebSocket connection time**." The FAQ says: "Billed per minute of WebSocket connection time, with one rate covering speech-to-text, a managed language model, and text-to-speech."
  - So idle connected time is billed, and the socket must be closed promptly.
  - Per-second versus rounded-up-minute granularity for Voice Agent: **[UNVERIFIED]**
- **Cost of a 3-minute call:** about **$0.225** at Standard. $200 is roughly 2,666 minutes, or about 888 three-minute calls.
- **$200 free credit:**
  - The pricing page says "No minimums, no expiration, and no credit card required. Free $200 credit then pay-as-you-go."
  - Deepgram's Voice Agent GA announcement says new sign-ups get $200 credit usable on Voice Agent, so **it covers Voice Agent** (the press release claimed "over 40 hours").
  - **Conflict:** `/guides/deep-dives/managing-projects` says "Deepgram free promotional credits expire one year from signup", while the pricing page says no expiration.
- **When credit runs out with no card:**
  - The documented behaviour is a **hard stop**: HTTP **402 Payment Required**, `{"err_code":"ASR_PAYMENT_REQUIRED","err_msg":"Project does not have enough credits for an ASR request and does not have an overage agreement."}`. This is from `/reference/errors`, written for transcription.
  - The pricing FAQ (Growth) says "without one [a card], requests return a 402 once credits run out."
  - For the Voice Agent WebSocket, the exact failure is **[UNVERIFIED]**. Likely the handshake is rejected with 402, or a mid-session close. Whether a session already in progress is cut off at zero balance is also unknown.
  - Handle a failed WS open, or an `Error`/close before `Welcome`, as "service unavailable".
- **Concurrency:** Pay as you go Voice Agent allows up to **45 concurrent connections** per project (all regions). Growth allows 60 in NA and 45 elsewhere.

---

## 8. Official examples and repos

- **Browser Agent SDK docs (vanilla JS):**
  - https://developers.deepgram.com/docs/browser-agent-overview
  - https://developers.deepgram.com/docs/browser-agent-javascript
  - Source monorepo: https://github.com/deepgram/agent (packages `@deepgram/agents`, `@deepgram/react`, `@deepgram/ui`, `@deepgram/agents-widget`)
- **Widget (no build step):** https://developers.deepgram.com/docs/browser-agent-widget
- **Web component, direct browser to Deepgram with subprotocol `[scheme, token]`:** https://github.com/deepgram/browser-agent. Note that it uses ScriptProcessor.
- **Pure HTML/CSS/JS frontend:** https://github.com/deepgram-starters/voice-agent-html. It talks to its **own backend proxy** (`access_token.<jwt>` subprotocol), not Deepgram directly. Its playback **does not handle barge-in**, so don't copy that part.
- **Starter apps (server-proxied):** https://github.com/deepgram-starters/node-voice-agent and the others listed at https://developers.deepgram.com/docs/voice-agent-template-apps
- **Long-session rollover reference:** https://github.com/deepgram-devs/voice-agent-long-sessions
- **Playground:** https://playground.deepgram.com/?endpoint=agent
- **Full doc index:** https://developers.deepgram.com/llms.txt. Append `.md` to any docs URL for raw markdown.

---

## Quick gotcha checklist

- **Message order.** Wait for `Welcome`, then send `Settings`, then wait for `SettingsApplied`, then send audio.
- **Exactly one `Settings`** per socket.
- **Subprotocol is two elements:** `["bearer", jwt]`, not `"Bearer jwt"` and not `"token=..."`.
- **`InjectAgentMessage` uses `message`;** `InjectUserMessage` uses `content`.
- **Don't send `agent.language`**, and don't send `speak.provider.language` with Deepgram voices.
- **Flux TTS output** must be `linear16`/`mulaw`/`alaw` with `container: "none"`.
- **`AgentStartedSpeaking` needs `experimental: true`.** Otherwise infer "agent speaking" from the first binary frame after `ConversationText`(assistant).
- **The token TTL does not limit session length.** Enforce the 3-minute cap on the client and rate-limit token minting.
- **Billing is on socket-open time.** Close the socket as soon as the call ends or the tab is hidden or unloaded (`pagehide`).
