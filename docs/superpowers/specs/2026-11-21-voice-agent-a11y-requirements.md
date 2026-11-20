# Voice agent: accessibility requirements (WCAG 2.2 AA)

Pre-implementation checklist from the accessibility lead pass. Implementers must meet every item; the post-build review checks against it.

## Structure and semantics
1. The call panel stays an in-page `<section aria-labelledby="callH">`, **not** a modal: no focus trap, page stays usable. Native `<button>`s only.
2. The WebGL orb canvas and the animated avatar bars are `aria-hidden="true"` and never the only carrier of state (1.4.1). Every visual state has a text equivalent in the status line.
3. Heading levels: the panel's title stays `h2`; no new headings inside unless they keep order.

## Focus management (2.4.3, 2.4.7, 3.2.1)
4. "Talk to my AI agent" → panel opens, focus moves to **End call** (existing behaviour); `aria-expanded` on the trigger stays in sync.
5. Ending (by button, Esc while focus is inside the panel, the 3:00 cap, or an error) hides the panel and returns focus to the trigger, with the end reason announced.
6. Esc inside the panel ends the call. No other single-key shortcuts.
7. The microphone toggle, chips, text input, send and End call are all reachable by Tab in visual order, with the existing 3px accent focus ring.

## Announcements (4.1.3)
8. Exactly **one** polite status region for call state (`#callState`, `role="status"`). Update it only on meaningful transitions: Connecting → Listening → Thinking → Agent speaking → Interrupted → Your turn → Call ended / error. No level- or frame-driven updates. Debounce so a transition under 400 ms is not announced.
9. Agent replies: announce the **final** agent text once per turn in a separate polite region (`aria-live="polite"`, `aria-atomic="true"`), never streaming partials. Visitor's own transcript is shown but **not** announced (they just said it).
10. The transcript log uses `role="log"` with `aria-live="off"` (visible history only), to avoid double reading with item 9.
11. Errors (mic denied, out of credit, network) go to an `role="alert"` region, once each.

## Typed input and chips (3.3.1, 3.3.2, 4.1.2)
12. Text input has a visible `<label>` ("Type a question"), sits in a `<form>`; Enter or the Send button submits; the input clears and keeps focus after submit. Empty submit does nothing.
13. Suggested-question chips sit in a `role="group"` with an accessible name; after use, keep focus on the activated chip or move it to the input, never to `body`.
14. Mic toggle is a `<button aria-pressed>` whose label stays constant ("Microphone"); state is conveyed by `aria-pressed` plus visible text "Mic on"/"Mic off".

## Microphone permission
15. Never request the mic before the user presses Talk. If denied/unavailable, announce via the alert region: "Microphone blocked. You can still type your questions." Move focus to the text input; the call continues in typed mode.

## Timing (2.2.1)
16. The 3-minute limit is an essential, real-time limit (a live call with a fixed free budget), so the 2.2.1 exception applies. Still: show the timer visibly, announce once at 2:30 ("30 seconds left") via the status region, and let the agent wrap up out loud. After ending, the visitor can start a new call immediately.
17. The timer element is `aria-hidden` per-second text with no live updates (only item 16's single warning is announced).

## Motion and audio (2.3.3, 1.4.2, 2.2.2)
18. `prefers-reduced-motion`: orb stays static/slow, no ripples or spin; call still fully works.
19. Audio only starts after the user's Talk click (it's the user's own action, so 1.4.2 is met). End call stops all audio at once.

## Contrast (1.4.3, 1.4.11)
20. Safe text pairs on `--panel #14161a` / `--bg #0e0f12`: `--fg #eef0f3` (≈16:1), `--muted #a3a8b2` (≈7.8:1), `--accent #ff7a4d` (≈7:1), visitor blue `#7fb2ff` (≈8:1).
21. **Fails:** `--line #2a2d34` borders are ≈1.4:1. Any control whose border is its only boundary (text input, chips, mic toggle) needs a border of at least 3:1: use `#6b7080` (≈3.9:1 on panel) or brighter.
22. The latency readout ("answered in 0.9 s") uses `--muted` mono at ≥ 0.8rem, and is decorative-informational: include it in the agent-reply log entry text, not a separate live region.

## Targets (2.5.8)
23. All interactive targets are at least 24×24 CSS px; keep the existing 36px chip height and give the mic toggle and Send button 40px or more.

## Captions
24. Live captions are always on during a call (both speakers labelled "You:" / "Agent:"), so the call is usable by deaf and hard-of-hearing visitors with typed input alone.
