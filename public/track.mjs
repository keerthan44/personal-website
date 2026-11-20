// First-party, cookie-less event beacon. Never throws, never blocks.
export function track(event, props) {
  try {
    const body = JSON.stringify(props ? { e: event, p: props } : { e: event });
    if (navigator.sendBeacon && navigator.sendBeacon('/api/track', new Blob([body], { type: 'text/plain' }))) return;
    fetch('/api/track', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  } catch (e) { /* ignore */ }
}
