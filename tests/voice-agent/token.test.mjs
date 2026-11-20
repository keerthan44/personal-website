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
