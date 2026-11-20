import { buildSettings } from './settings.mjs';

const GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';
const TTL_SECONDS = 30;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const PER_MINUTE = 5;
const PER_DAY = 40;
const DEFAULT_ORIGINS = 'https://www.itskeerthan.com,https://itskeerthan.com';

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  const first = Array.isArray(xff) ? xff[0] : xff;
  if (first) {
    const ip = String(first).split(',')[0].trim();
    if (ip) return ip;
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

export function createTokenHandler({ fetchImpl, env, now }) {
  const hits = new Map(); // ip -> timestamps (ms) within the last 24h

  function send(res, status, body) {
    res.status(status).json(body);
  }

  function originAllowed(origin) {
    if (!origin) return false;
    const allowed = (env.VOICE_ALLOWED_ORIGINS || DEFAULT_ORIGINS)
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.includes(origin)) return true;
    if (env.NODE_ENV !== 'production') {
      return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    }
    return false;
  }

  // Returns retryAfter seconds if limited, else 0 (and records the hit).
  function checkRate(ip) {
    const t = now();
    const list = (hits.get(ip) || []).filter((x) => t - x < DAY_MS);
    const lastMinute = list.filter((x) => t - x < MINUTE_MS);
    let retryAfter = 0;
    if (lastMinute.length >= PER_MINUTE) {
      retryAfter = Math.ceil((lastMinute[0] + MINUTE_MS - t) / 1000);
    } else if (list.length >= PER_DAY) {
      retryAfter = Math.ceil((list[0] + DAY_MS - t) / 1000);
    }
    if (retryAfter > 0) {
      hits.set(ip, list);
      return Math.max(retryAfter, 1);
    }
    list.push(t);
    hits.set(ip, list);
    return 0;
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return send(res, 405, { error: 'method_not_allowed' });
    }
    if (!originAllowed(req.headers.origin)) {
      return send(res, 403, { error: 'origin' });
    }
    const retryAfter = checkRate(clientIp(req));
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      return send(res, 429, { error: 'rate_limited', retryAfter });
    }
    const key = env.DEEPGRAM_API_KEY;
    if (!key) {
      console.error('voice-token: DEEPGRAM_API_KEY is not set');
      return send(res, 503, { error: 'unavailable' });
    }
    try {
      const r = await fetchImpl(GRANT_URL, {
        method: 'POST',
        headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl_seconds: TTL_SECONDS }),
      });
      if (!r.ok) {
        console.error(`voice-token: grant failed with status ${r.status}`);
        return send(res, 503, { error: 'unavailable' });
      }
      const data = await r.json();
      if (!data || !data.access_token) {
        console.error('voice-token: grant response missing access_token');
        return send(res, 503, { error: 'unavailable' });
      }
      return send(res, 200, {
        token: data.access_token,
        expiresIn: data.expires_in,
        settings: buildSettings(),
      });
    } catch (err) {
      console.error('voice-token: grant request error', err && err.name);
      return send(res, 503, { error: 'unavailable' });
    }
  };
}
