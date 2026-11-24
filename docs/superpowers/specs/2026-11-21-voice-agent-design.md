# Talk to my AI agent: real voice agent (design)

Date: 2026-11-21 · Status: approved in conversation

## Intent
The new one-pager has a "Talk to my AI agent" button. Today it fakes the call:
keyword matching against six canned answers, spoken by the browser's built-in voice.
Replace it with a real voice agent that a recruiter can just talk to, and that
answers anything about Keerthan's work from his résumé. It has to feel genuinely
impressive: fast replies, natural voice, interruptible, with the turn-taking orb
reacting to what is really happening in the call.

## Goals
- Real conversation: speak naturally, get a spoken answer in about a second, cut in any time.
- The turn-taking orb is the hero and is driven by real call events and real audio levels.
- $0: no paid plan, no card. When the free credit runs out the agent goes quiet, never bills.
- Works for people who can't or won't use a microphone (typed questions, captions).
- WCAG AA: keyboard operable, screen reader announced, no colour-only state.

## Non-goals
- LiveKit / Pipecat / any hosted agent backend or CI/CD deploy (nothing to host).
- Switching the live homepage `/` to the new page (separate decision).
- Phone-number calling, analytics, storing transcripts.

## Anti-goals
- Hallucinated claims about Keerthan. The agent must only say what the résumé supports.
- An API key in the browser or in git.
- A call that hangs silently on errors: every failure ends in a clear message.

## Approaches considered
| Approach | Trade-off | Decision |
|---|---|---|
| LiveKit Cloud (free Build) + Deepgram STT/TTS + Groq LLM | Most "showcase", but 10–20 s cold start on the free plan, more moving parts, CI/CD needed | Rejected: Keerthan doesn't need to prove the framework |
| Pipecat self-hosted on a free host | ~60 s wake from sleep, WebSocket-only audio, no free managed option | Rejected |
| Gemini Live (speech-to-speech) | Free today but trains on visitor audio, unpublished limits, preview models retiring | Rejected |
| **Deepgram Voice Agent API, browser connects directly** | ~$0.075/min from the one-time $200 credit (>1 year at realistic traffic); no cold start; fewest parts; Aura-2 voice is clear but less expressive than ElevenLabs | **Chosen** |

## Design
### Pieces
- `public/pro.html`: the one-pager with the turn-taking orb (copied from the hero6-turn prototype). Served at `/pro.html` by the existing Next.js app so it shares an origin with the API route.
- `public/voice/`: browser voice engine as plain ES modules (no bundler):
  - audio capture: microphone → AudioWorklet → linear16 mono at the agent's input rate, plus a live mic level.
  - audio playback: linear16 from the agent → AudioWorklet queue, instant flush on barge-in, plus a live output level.
  - agent client: token fetch, WebSocket, Settings, KeepAlive, typed event emitter (`state`, `userText`, `agentText`, `levels`, `latency`, `error`, `end`).
- `pages/api/voice-token.ts`: mints a short-lived Deepgram token with the server-side key, returns `{ token, settings }`. Checks Origin, light per-IP rate limit, no-store.
- `voice-agent/`: the agent's brain, kept in one place: `resume.md` (facts extracted from the PDF résumé, reviewed by Keerthan), `prompt.ts` (persona and rules), `settings.ts` (builds the Deepgram Settings message: Nova-3 listen, managed fast LLM, Aura-2 voice, greeting).

### Call behaviour
- Greeting spoken on connect. Hard 3:00 cap with a spoken wrap-up; a visible timer; a gentle warning at 2:30.
- Orb mapping: visitor speaking → blue dent driven by mic level; thinking → spinning bands; agent speaking → orange ripples driven by output level; interruption snaps orange to blue and flushes queued audio immediately.
- Live captions of both sides; suggested-question chips and a text box send typed questions into the same conversation.
- Per-turn response time shown in small mono text (e.g. "answered in 0.9 s"): proof of speed without saying it.
- If the mic is blocked: call continues in typed mode. If Deepgram is unreachable or out of credit: a clear message, and the old scripted answers stay available as an offline fallback.

### Agent rules (prompt)
Speaks as Keerthan in the first person ("I built…"), framed as an AI voice of him: the greeting, button and panel heading disclose it, and it always answers truthfully when asked if it is an AI. Short spoken answers (1–3 sentences, short sentences, commas and periods for pauses, no colons, semicolons, dashes or markup), only résumé facts, tolerant of misheard names and terms, and never promises anything (no dates, salary, emails or scheduling); it points to "Book a time" (Cal.com) instead. Guardrails, in priority order: harmful requests, role-change or prompt-reveal attempts, insults, private topics, off-topic tasks, unknowns. (Updated 2026-11-21: was third person.)

### Secrets and limits
`DEEPGRAM_API_KEY` lives in `.env.local` (git-ignored) and Vercel env vars. Tokens are short-lived. The 3-minute cap is enforced by the page; worst case, abuse drains the free credit and the agent stops (no bill).

## Left to the builder
Exact Deepgram message shapes and voice/model choices (from the API reference), audio sample rates, worklet details, visual styling of captions/latency text within the page's existing design tokens.
