import test from 'node:test';
import assert from 'node:assert';
import { createTokenHandler } from '../../voice-agent/token.mjs';

function mkRes() {
  const res = { headers: {}, statusCode: 0, body: undefined };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
const mkReq = (o = {}) => ({
  method: 'POST',
  headers: { origin: 'https://www.itskeerthan.com', 'x-forwarded-for': '1.2.3.4, 9.9.9.9' },
  socket: { remoteAddress: '127.0.0.1' },
  ...o,
});
function setup(envOver = {}, fetchOver) {
  const calls = [];
  const fetchImpl = fetchOver || (async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 30 }) };
  });
  let t = 1_000_000;
  const clock = { advance: (ms) => { t += ms; } };
  const wrapped = async (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); };
  const env = { DEEPGRAM_API_KEY: 'k', NODE_ENV: 'production', ...envOver };
  const handler = createTokenHandler({ fetchImpl: fetchOver ? wrapped : fetchImpl, env, now: () => t });
  return { handler, calls, clock };
}

test('GET -> 405', async () => {
  const { handler } = setup();
  const res = mkRes();
  await handler(mkReq({ method: 'GET' }), res);
  assert.strictEqual(res.statusCode, 405);
});

test('bad origin -> 403, no fetch', async () => {
  const { handler, calls } = setup();
  const res = mkRes();
  await handler(mkReq({ headers: { origin: 'https://evil.example' } }), res);
  assert.strictEqual(res.statusCode, 403);
  assert.deepStrictEqual(res.body, { error: 'origin' });
  assert.strictEqual(calls.length, 0);
});

test('localhost allowed outside production only', async () => {
  const dev = setup({ NODE_ENV: 'development' });
  const r1 = mkRes();
  await dev.handler(mkReq({ headers: { origin: 'http://localhost:3000' } }), r1);
  assert.strictEqual(r1.statusCode, 200);
  const prod = setup();
  const r2 = mkRes();
  await prod.handler(mkReq({ headers: { origin: 'http://localhost:3000' } }), r2);
  assert.strictEqual(r2.statusCode, 403);
});

test('success', async () => {
  const { handler, calls } = setup();
  const res = mkRes();
  await handler(mkReq(), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.token, 't');
  assert.strictEqual(res.body.expiresIn, 30);
  assert.strictEqual(res.body.settings.type, 'Settings');
  assert.strictEqual(res.headers['cache-control'], 'no-store');
  assert.strictEqual(calls[0].url, 'https://api.deepgram.com/v1/auth/grant');
  assert.strictEqual(calls[0].init.headers.Authorization, 'Token k');
  assert.strictEqual(calls[0].init.body, '{"ttl_seconds":30}');
});

test('missing key -> 503', async () => {
  const { handler } = setup({ DEEPGRAM_API_KEY: undefined });
  const res = mkRes();
  await handler(mkReq(), res);
  assert.strictEqual(res.statusCode, 503);
});

test('upstream 401 -> 503, key not leaked', async () => {
  const { handler } = setup({ DEEPGRAM_API_KEY: 'secret-key-123' },
    async () => ({ ok: false, status: 401, json: async () => ({}) }));
  const res = mkRes();
  await handler(mkReq(), res);
  assert.strictEqual(res.statusCode, 503);
  assert.deepStrictEqual(res.body, { error: 'unavailable' });
  assert.ok(!JSON.stringify(res.body).includes('secret-key-123'));
});

test('per-minute rate limit by x-forwarded-for first entry', async () => {
  const { handler, clock } = setup();
  for (let i = 0; i < 5; i++) {
    const r = mkRes();
    await handler(mkReq(), r);
    assert.strictEqual(r.statusCode, 200);
  }
  const limited = mkRes();
  await handler(mkReq(), limited);
  assert.strictEqual(limited.statusCode, 429);
  assert.strictEqual(limited.body.error, 'rate_limited');
  assert.ok(limited.body.retryAfter > 0);
  // other IP unaffected
  const other = mkRes();
  await handler(mkReq({ headers: { origin: 'https://www.itskeerthan.com', 'x-forwarded-for': '5.5.5.5' } }), other);
  assert.strictEqual(other.statusCode, 200);
  clock.advance(61_000);
  const again = mkRes();
  await handler(mkReq(), again);
  assert.strictEqual(again.statusCode, 200);
});

test('falls back to socket address', async () => {
  const { handler } = setup();
  const h = { origin: 'https://www.itskeerthan.com' };
  for (let i = 0; i < 5; i++) await handler(mkReq({ headers: h }), mkRes());
  const r = mkRes();
  await handler(mkReq({ headers: h }), r);
  assert.strictEqual(r.statusCode, 429);
});

test('daily cap of 40 per IP', async () => {
  const { handler, clock } = setup();
  for (let i = 0; i < 40; i++) {
    const r = mkRes();
    await handler(mkReq(), r);
    assert.strictEqual(r.statusCode, 200, `request ${i}`);
    clock.advance(15_000); // 4/min, under the minute cap
  }
  const r = mkRes();
  await handler(mkReq(), r);
  assert.strictEqual(r.statusCode, 429);
  clock.advance(24 * 3600 * 1000);
  const ok = mkRes();
  await handler(mkReq(), ok);
  assert.strictEqual(ok.statusCode, 200);
});

// ---------- credit protection (Redis-backed caps) ----------
const REDIS_ENV = { UPSTASH_REDIS_REST_URL: 'https://r.example', UPSTASH_REDIS_REST_TOKEN: 'tok', ANALYTICS_SALT: 's' };
const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);

// Minimal in-memory Redis behind the REST pipeline endpoint.
function fakeRedis() {
  const hashes = new Map();
  const strs = new Map();
  const ttls = new Map();
  const cmds = [];
  function run([op, key, ...a]) {
    cmds.push([op, key, ...a]);
    switch (op) {
      case 'HGET': { const h = hashes.get(key); return h && h[a[0]] != null ? String(h[a[0]]) : null; }
      case 'HINCRBY': { const h = hashes.get(key) || {}; h[a[0]] = (h[a[0]] || 0) + Number(a[1]); hashes.set(key, h); return h[a[0]]; }
      case 'INCR': { const v = (strs.get(key) || 0) + 1; strs.set(key, v); return v; }
      case 'TTL': return ttls.has(key) ? ttls.get(key) : (strs.has(key) || hashes.has(key) ? -1 : -2);
      case 'EXPIRE': ttls.set(key, Number(a[0])); return 1;
      default: return null;
    }
  }
  return { hashes, strs, ttls, cmds, handle: (body) => JSON.parse(body).map((c) => ({ result: run(c) })) };
}

function capSetup(envOver = {}, { hang = false } = {}) {
  const redis = fakeRedis();
  const grants = [];
  let t = T0;
  const fetchImpl = async (url, init) => {
    if (url.includes('deepgram')) { grants.push(url); return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 30 }) }; }
    if (hang) return new Promise(() => {});
    return { ok: true, status: 200, json: async () => redis.handle(init.body) };
  };
  const env = { DEEPGRAM_API_KEY: 'k', NODE_ENV: 'production', ...REDIS_ENV, ...envOver };
  const handler = createTokenHandler({ fetchImpl, env, now: () => t });
  return { handler, redis, grants, clock: { advance: (ms) => { t += ms; } } };
}

test('daily cap reached -> 429 daily_cap with retryAfter to UTC midnight, no grant', async () => {
  const s = capSetup({ VERCEL_ENV: 'production', VOICE_DAILY_CAP: '3' });
  s.redis.hashes.set('production:day:2026-11-21', { token: 3 });
  const res = mkRes();
  await s.handler(mkReq(), res);
  assert.strictEqual(res.statusCode, 429);
  assert.strictEqual(res.body.error, 'daily_cap');
  assert.strictEqual(res.body.retryAfter, 12 * 3600);
  assert.strictEqual(res.headers['retry-after'], String(12 * 3600));
  assert.strictEqual(s.grants.length, 0);
});

test('daily cap defaults: 60 in production, 200 elsewhere', async () => {
  const p = capSetup({ VERCEL_ENV: 'production' });
  p.redis.hashes.set('production:day:2026-11-21', { token: 59 });
  const r1 = mkRes(); await p.handler(mkReq(), r1);
  assert.strictEqual(r1.statusCode, 200);
  assert.strictEqual(p.redis.hashes.get('production:day:2026-11-21').token, 60, 'counted after grant');
  const r2 = mkRes(); await p.handler(mkReq({ headers: { origin: 'https://www.itskeerthan.com', 'x-forwarded-for': '7.7.7.7' } }), r2);
  assert.strictEqual(r2.statusCode, 429);
  assert.strictEqual(r2.body.error, 'daily_cap');
  const v = capSetup({ VERCEL_ENV: 'preview' });
  v.redis.hashes.set('preview:day:2026-11-21', { token: 199 });
  const r3 = mkRes(); await v.handler(mkReq(), r3);
  assert.strictEqual(r3.statusCode, 200);
  const r4 = mkRes(); await v.handler(mkReq(), r4);
  assert.strictEqual(r4.statusCode, 429);
});

test('per-IP hourly cap in Redis: 9th call in an hour -> 429 rate_limited', async () => {
  const s = capSetup({ VERCEL_ENV: 'production' });
  for (let i = 0; i < 8; i++) {
    const r = mkRes();
    await s.handler(mkReq(), r);
    assert.strictEqual(r.statusCode, 200, `call ${i + 1}`);
    s.clock.advance(20_000); // stays under the in-memory 5/min limit
  }
  const r = mkRes();
  await s.handler(mkReq(), r);
  assert.strictEqual(r.statusCode, 429);
  assert.strictEqual(r.body.error, 'rate_limited');
  assert.ok(r.body.retryAfter > 0);
  assert.strictEqual(s.grants.length, 8);
  const ipKeys = [...s.redis.strs.keys()];
  assert.strictEqual(ipKeys.length, 1);
  assert.match(ipKeys[0], /^production:ipcap:[0-9a-f]{16}$/);
  assert.ok(!ipKeys[0].includes('1.2.3.4'));
  assert.strictEqual(s.redis.ttls.get(ipKeys[0]), 3600, 'expiry set');
  // another IP is unaffected
  const o = mkRes();
  await s.handler(mkReq({ headers: { origin: 'https://www.itskeerthan.com', 'x-forwarded-for': '5.5.5.5' } }), o);
  assert.strictEqual(o.statusCode, 200);
});

test('production without ANALYTICS_SALT skips the Redis per-IP cap', async () => {
  const s = capSetup({ VERCEL_ENV: 'production', ANALYTICS_SALT: '' });
  for (let i = 0; i < 10; i++) {
    const r = mkRes();
    await s.handler(mkReq(), r);
    assert.strictEqual(r.statusCode, 200, `call ${i + 1}`);
    s.clock.advance(20_000);
  }
  assert.strictEqual(s.redis.strs.size, 0, 'no ipcap key written');
});

test('VOICE_IP_HOURLY_CAP overrides the per-IP cap', async () => {
  const s = capSetup({ VOICE_IP_HOURLY_CAP: '2' });
  for (let i = 0; i < 2; i++) { const r = mkRes(); await s.handler(mkReq(), r); assert.strictEqual(r.statusCode, 200); }
  const r = mkRes(); await s.handler(mkReq(), r);
  assert.strictEqual(r.statusCode, 429);
  assert.strictEqual(r.body.error, 'rate_limited');
});

test('Redis hanging -> grant still works within the timeout', async () => {
  const s = capSetup({ VERCEL_ENV: 'production' }, { hang: true });
  const res = mkRes();
  const t = Date.now();
  await s.handler(mkReq(), res);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(s.grants.length, 1);
  assert.ok(Date.now() - t < 1500);
});

// ---------- preview origins ----------
test('preview deployment URLs are allowed (exact match only)', async () => {
  const env = { VERCEL_URL: 'site-abc123.vercel.app', VERCEL_BRANCH_URL: 'site-git-feat-x.vercel.app' };
  for (const [origin, code] of [
    ['https://site-abc123.vercel.app', 200],
    ['https://site-git-feat-x.vercel.app', 200],
    ['http://site-abc123.vercel.app', 403],
    ['https://evil-site-abc123.vercel.app', 403],
    ['https://site-abc123.vercel.app.evil.com', 403],
  ]) {
    const { handler } = setup(env);
    const r = mkRes();
    await handler(mkReq({ headers: { origin } }), r);
    assert.strictEqual(r.statusCode, code, origin);
  }
  const { originAllowed } = await import('../../voice-agent/guard.mjs');
  assert.strictEqual(originAllowed({ NODE_ENV: 'production' }, 'https://undefined'), false);
});
