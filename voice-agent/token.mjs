import { createHash } from 'node:crypto';
import { buildSettings } from './settings.mjs';
import { clientIp, originAllowed as originOk } from './guard.mjs';
import { redisFromEnv, dayKey, settle, envName } from './analytics.mjs';

const GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';
const TTL_SECONDS = 30;
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const PER_MINUTE = 5;
const PER_DAY = 40;
const IP_WINDOW_S = 3600;
const REDIS_TIMEOUT_MS = 400;

const posInt = (v, dflt) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

export function createTokenHandler({ fetchImpl, env, now }) {
  const hits = new Map(); // ip -> timestamps (ms) within the last 24h

  function send(res, status, body) {
    res.status(status).json(body);
  }

  const originAllowed = (origin) => originOk(env, origin);

  // Shared caps in Redis (survive cold starts, span instances). Returns a
  // 429 body or null. Redis missing, slow or failing -> null (never block).
  async function checkCaps(redis, ip) {
    const pre = envName(env);
    const t = now();
    const day = `${pre}:day:${dayKey(t)}`;
    // No salt in production: don't hash IPs with a constant, skip the shared per-IP cap.
    const salt = env.ANALYTICS_SALT || (pre === 'production' ? '' : 'ipcap');
    const ipKey = salt ? `${pre}:ipcap:${createHash('sha256').update(ip + salt).digest('hex').slice(0, 16)}` : null;
    let out;
    try {
      out = await settle(redis.pipeline(ipKey ? [['HGET', day, 'token'], ['INCR', ipKey], ['TTL', ipKey]] : [['HGET', day, 'token']]), REDIS_TIMEOUT_MS);
    } catch { return null; }
    if (!Array.isArray(out)) return null;
    const val = (i) => (out[i] && out[i].result != null ? Number(out[i].result) : NaN);
    const used = val(0);
    const ipCount = val(1);
    const ttl = val(2);
    // Set the window on first use; also heals a key that lost its expiry.
    if (Number.isFinite(ipCount) && !(ttl > 0)) {
      await settle(redis.pipeline([['EXPIRE', ipKey, IP_WINDOW_S]]), REDIS_TIMEOUT_MS);
    }
    const dailyCap = posInt(env.VOICE_DAILY_CAP, pre === 'production' ? 60 : 200);
    if (Number.isFinite(used) && used >= dailyCap) {
      const midnight = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate() + 1);
      return { error: 'daily_cap', retryAfter: Math.max(1, Math.ceil((midnight - t) / 1000)) };
    }
    if (Number.isFinite(ipCount) && ipCount > posInt(env.VOICE_IP_HOURLY_CAP, 8)) {
      return { error: 'rate_limited', retryAfter: ttl > 0 ? ttl : IP_WINDOW_S };
    }
    return null;
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
    const ip = clientIp(req);
    const retryAfter = checkRate(ip);
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      return send(res, 429, { error: 'rate_limited', retryAfter });
    }
    const key = env.DEEPGRAM_API_KEY;
    if (!key) {
      console.error('voice-token: DEEPGRAM_API_KEY is not set');
      return send(res, 503, { error: 'unavailable' });
    }
    let redis = null;
    try { redis = redisFromEnv(env, fetchImpl); } catch { redis = null; }
    if (redis) {
      const capped = await checkCaps(redis, ip);
      if (capped) {
        res.setHeader('Retry-After', String(capped.retryAfter));
        return send(res, 429, capped);
      }
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
      try {
        if (redis) {
          const day = `${envName(env)}:day:${dayKey(now())}`;
          // Awaited (bounded) so serverless doesn't freeze before it lands.
          await settle(redis.pipeline([['HINCRBY', day, 'token', 1], ['EXPIRE', day, 8640000]]), 400);
        }
      } catch { /* analytics must never affect the grant */ }
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
