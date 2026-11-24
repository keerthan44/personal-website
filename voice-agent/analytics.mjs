import { createHash, timingSafeEqual } from 'node:crypto';
import { clientIp, originAllowed } from './guard.mjs';

export const EVENTS = ['view', 'talk-click', 'book-click', 'call-connected', 'call-offline', 'call-ended', 'question'];

const ALLOWED_PROPS = {
  kind: ['connect', 'token', 'rate_limited', 'agent', 'network'],
  reason: ['user', 'cap', 'error', 'remote'],
  secs: ['<15', '15-60', '60-120', '120+'],
  via: ['voice', 'typed', 'chip'],
};
// Events that also get a per-country count (Vercel's geo header, two-letter code).
const COUNTRY_EVENTS = ['view', 'talk-click', 'book-click'];
const COUNTRY_RE = /^[A-Z]{2}$/;
const MAX_COUNTRIES = 25;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|preview|curl|wget|python|httpclient/i;
const TTL = 8640000; // 100 days
const WINDOW_MS = 10 * 60 * 1000;
const MAX_EVENTS = 60;
const DAY_MS = 24 * 3600 * 1000;
const STATS_DAYS = 30;

export function redisFromEnv(env, fetchImpl) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return {
    async pipeline(cmds) {
      const r = await fetchImpl(`${url.replace(/\/+$/, '')}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmds),
      });
      if (!r.ok) throw new Error(`redis_${r.status}`);
      return r.json();
    },
  };
}

// Await a promise but give up after ms; never rejects.
export function settle(promise, ms = 400) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, ms); });
  return Promise.race([Promise.resolve(promise).catch(() => {}), timeout]).finally(() => clearTimeout(timer));
}

export const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

export const ENVS = ['production', 'preview', 'development'];

// The deployment environment; every Redis key is prefixed with it.
export function envName(env) {
  const v = env && env.VERCEL_ENV;
  return ENVS.includes(v) ? v : 'development';
}

export function createTrackHandler({ fetchImpl, env, now }) {
  const hits = new Map(); // ip -> timestamps within the window

  function limited(ip) {
    const t = now();
    const list = (hits.get(ip) || []).filter((x) => t - x < WINDOW_MS);
    if (list.length >= MAX_EVENTS) { hits.set(ip, list); return true; }
    list.push(t);
    hits.set(ip, list);
    return false;
  }

  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).end();
    }
    const done = () => res.status(204).end();
    try {
      let body = req.body;
      if (typeof body === 'string') {
        if (body.length > 1024) return done();
        body = JSON.parse(body);
      }
      if (!body || typeof body !== 'object' || !EVENTS.includes(body.e)) return done();
      if (JSON.stringify(body).length > 1024) return done();
      if (!originAllowed(env, req.headers.origin)) return done();
      const ua = String(req.headers['user-agent'] || '');
      if (!ua || BOT_RE.test(ua)) return done();
      const ip = clientIp(req);
      if (limited(ip)) return done();
      const redis = redisFromEnv(env, fetchImpl);
      if (!redis) return done();

      const d = dayKey(now());
      const pre = envName(env);
      const day = `${pre}:day:${d}`;
      const e = body.e;
      const cmds = [['HINCRBY', day, e, 1]];
      const p = body.p && typeof body.p === 'object' ? body.p : {};
      for (const key of Object.keys(ALLOWED_PROPS)) {
        const val = p[key];
        if (typeof val === 'string' && ALLOWED_PROPS[key].includes(val)) {
          cmds.push(['HINCRBY', day, `${e}:${key}=${val}`, 1]);
        }
      }
      const cc = req.headers['x-vercel-ip-country'];
      if (COUNTRY_EVENTS.includes(e) && typeof cc === 'string' && COUNTRY_RE.test(cc)) {
        cmds.push(['HINCRBY', day, `${e}:country=${cc}`, 1]);
      }
      cmds.push(['EXPIRE', day, TTL]);
      const salt = env.ANALYTICS_SALT || (env.NODE_ENV === 'production' ? '' : 'portfolio');
      if (e === 'view' && salt) {
        const hash = createHash('sha256')
          .update(`${d}|${ip}|${ua}|${salt}`)
          .digest('hex').slice(0, 16);
        cmds.push(['PFADD', `${pre}:uv:${d}`, hash], ['EXPIRE', `${pre}:uv:${d}`, TTL]);
      }
      await settle(redis.pipeline(cmds));
    } catch (err) {
      console.error('track: failed', err && err.name);
    }
    return done();
  };
}

function toMap(raw) {
  const m = {};
  if (Array.isArray(raw)) {
    for (let i = 0; i + 1 < raw.length; i += 2) m[raw[i]] = Number(raw[i + 1]) || 0;
  } else if (raw && typeof raw === 'object') {
    for (const k of Object.keys(raw)) m[k] = Number(raw[k]) || 0;
  }
  return m;
}

function keyOk(env, given) {
  const want = env.STATS_KEY;
  if (!want || typeof given !== 'string' || !given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(want).digest();
  return timingSafeEqual(a, b);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch { /* fall back to codes */ }
const countryName = (code) => { try { return (regionNames && regionNames.of(code)) || code; } catch { return code; } };
const geoRow = (c) => `<tr><th scope="row">${esc(countryName(c.code))}</th><td>${c.views}</td><td>${c.talkClicks}</td><td>${c.bookClicks}</td></tr>`;

function renderHtml(data, key) {
  const t = data.totals;
  const switcher = ENVS.map((name) => (name === data.env
    ? `<li><span aria-current="page">${name}</span></li>`
    : `<li><a href="?key=${esc(encodeURIComponent(key))}&amp;env=${name}">${name}</a></li>`)).join('');
  const row = (r) => `<tr><th scope="row">${esc(r.date)}</th><td>${r.visitors}</td><td>${r.views}</td><td>${r.talkClicks}</td><td>${r.clickRate}%</td><td>${r.bookClicks}</td><td>${r.connected}</td><td>${r.offline}</td><td>${r.tokens}</td><td>${r.lengths['<15']} / ${r.lengths['15-60']} / ${r.lengths['60-120']} / ${r.lengths['120+']}</td><td>${r.questions}</td></tr>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Site stats (${esc(data.env)})</title>
<style>
:root{--bg:#0e0f12;--fg:#eef0f3;--muted:#a3a8b2;--accent:#ff7a4d;--line:#2a2d34}
*{box-sizing:border-box}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto}
h2{font-size:1.1rem;margin:24px 0 8px}.sum{display:flex;flex-wrap:wrap;gap:8px 24px;list-style:none;padding:0;margin:0 0 24px;color:var(--muted)}.sum b{color:var(--fg)}
h1{font-size:1.6rem;margin:0 0 8px}
p{color:var(--muted);margin:0 0 20px}
.wrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;min-width:720px}
table.geo{min-width:0;max-width:560px}
caption{text-align:left;color:var(--muted);padding:8px 0}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;font-variant-numeric:tabular-nums}
thead th{color:var(--accent);font-weight:600}
tbody th,thead th:first-child{text-align:left}
tfoot th,tfoot td{color:var(--fg);font-weight:700;border-top:2px solid var(--accent)}
nav ul{display:flex;gap:16px;list-style:none;padding:0;margin:0 0 20px}
nav a{color:var(--accent)}nav a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
nav [aria-current]{color:var(--fg);font-weight:700}
</style></head><body><main>
<h1>Site stats: ${esc(data.env)}</h1>
<p>Environment: ${esc(data.env)}. Last ${STATS_DAYS} days, UTC. No cookies, no stored IPs.</p>
<nav aria-label="Environment"><ul>${switcher}</ul></nav>
<section aria-labelledby="sum"><h2 id="sum">30-day totals</h2>
<ul class="sum"><li>Visitors (sum of daily) <b>${t.visitors}</b></li><li>Views <b>${t.views}</b></li><li>Talk clicks <b>${t.talkClicks}</b> (${t.clickRate}%)</li><li>Book clicks <b>${t.bookClicks}</b></li><li>Connected <b>${t.connected}</b></li><li>Offline <b>${t.offline}</b></li><li>Calls started (server) <b>${t.tokens}</b></li><li>Questions <b>${t.questions}</b></li></ul></section>
<div class="wrap"><table>
<caption>Daily visits and AI agent calls (${esc(data.env)}), newest first. Call lengths are counts of calls under 15 s / 15-60 s / 60-120 s / 120 s or more.</caption>
<thead><tr><th scope="col">Date</th><th scope="col">Visitors</th><th scope="col">Views</th><th scope="col">Talk clicks</th><th scope="col">Click rate</th><th scope="col">Book clicks</th><th scope="col">Connected</th><th scope="col">Offline</th><th scope="col">Calls started (server)</th><th scope="col">Call lengths</th><th scope="col">Questions</th></tr></thead>
<tbody>${data.days.map(row).join('')}</tbody>
<tfoot><tr><th scope="row">30-day total</th><td>${t.visitors}</td><td>${t.views}</td><td>${t.talkClicks}</td><td>${t.clickRate}%</td><td>${t.bookClicks}</td><td>${t.connected}</td><td>${t.offline}</td><td>${t.tokens}</td><td>${t.lengths['<15']} / ${t.lengths['15-60']} / ${t.lengths['60-120']} / ${t.lengths['120+']}</td><td>${t.questions}</td></tr></tfoot>
</table></div>
<section aria-labelledby="geoH"><h2 id="geoH">Where visitors come from</h2>
<div class="wrap"><table class="geo">
<caption>Views, talk clicks and book clicks by visitor country (${esc(data.env)}), last ${STATS_DAYS} days, most clicks first. Top ${MAX_COUNTRIES} countries.</caption>
<thead><tr><th scope="col">Country</th><th scope="col">Views</th><th scope="col">Talk clicks</th><th scope="col">Book clicks</th></tr></thead>
<tbody>${data.countries.length ? data.countries.map(geoRow).join('') : '<tr><td colspan="4">No country data yet.</td></tr>'}</tbody>
</table></div></section></main></body></html>`;
}

export function createStatsHandler({ fetchImpl, env, now }) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    const q = req.query || {};
    if (req.method !== 'GET' || !keyOk(env, typeof q.key === 'string' ? q.key : '')) {
      return res.status(404).send('Not found');
    }
    const redis = redisFromEnv(env, fetchImpl);
    if (!redis) return res.status(503).send('Analytics store not configured');
    const pre = ENVS.includes(q.env) ? q.env : envName(env);
    const t = now();
    const dates = [];
    for (let i = 0; i < STATS_DAYS; i++) dates.push(dayKey(t - i * DAY_MS));
    let out;
    try {
      out = await redis.pipeline(dates.flatMap((d) => [['PFCOUNT', `${pre}:uv:${d}`], ['HGETALL', `${pre}:day:${d}`]]));
    } catch (err) {
      console.error('stats: failed', err && err.name);
      return res.status(502).send('Analytics store unavailable');
    }
    const blank = () => ({ visitors: 0, tokens: 0, views: 0, talkClicks: 0, bookClicks: 0, clickRate: 0, connected: 0, offline: 0, questions: 0, lengths: { '<15': 0, '15-60': 0, '60-120': 0, '120+': 0 } });
    const byCountry = {};
    const days = dates.map((date, i) => {
      const h = toMap(out[i * 2 + 1] && out[i * 2 + 1].result);
      const r = blank();
      r.date = date;
      r.visitors = Number(out[i * 2] && out[i * 2].result) || 0;
      r.views = h.view || 0;
      r.talkClicks = h['talk-click'] || 0;
      r.bookClicks = h['book-click'] || 0;
      for (const [k, v] of Object.entries(h)) {
        const m = /^(view|talk-click|book-click):country=([A-Z]{2})$/.exec(k);
        if (!m) continue;
        const c = byCountry[m[2]] || (byCountry[m[2]] = { code: m[2], views: 0, talkClicks: 0, bookClicks: 0 });
        c[{ view: 'views', 'talk-click': 'talkClicks', 'book-click': 'bookClicks' }[m[1]]] += v;
      }
      r.connected = h['call-connected'] || 0;
      r.offline = h['call-offline'] || 0;
      r.tokens = h.token || 0;
      r.questions = h.question || 0;
      for (const k of Object.keys(r.lengths)) r.lengths[k] = h[`call-ended:secs=${k}`] || 0;
      r.clickRate = r.views ? Math.round((r.talkClicks / r.views) * 1000) / 10 : 0;
      return r;
    });
    const totals = blank();
    for (const r of days) {
      for (const k of ['visitors', 'tokens', 'views', 'talkClicks', 'bookClicks', 'connected', 'offline', 'questions']) totals[k] += r[k];
      for (const k of Object.keys(totals.lengths)) totals.lengths[k] += r.lengths[k];
    }
    totals.clickRate = totals.views ? Math.round((totals.talkClicks / totals.views) * 1000) / 10 : 0;
    const countries = Object.values(byCountry)
      .sort((a, b) => (b.talkClicks + b.bookClicks) - (a.talkClicks + a.bookClicks) || b.views - a.views || a.code.localeCompare(b.code))
      .slice(0, MAX_COUNTRIES);
    const data = { env: pre, days, totals, countries };
    if (q.format === 'json') return res.status(200).json(data);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(200).send(renderHtml(data, q.key));
  };
}
