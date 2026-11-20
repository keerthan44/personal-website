import test from 'node:test';
import assert from 'node:assert';
import { createTrackHandler, createStatsHandler, redisFromEnv, EVENTS } from '../../voice-agent/analytics.mjs';
import { createTokenHandler } from '../../voice-agent/token.mjs';

function mkRes() {
  const res = { headers: {}, statusCode: 0, body: undefined, ended: false };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; return res; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; res.ended = true; return res; };
  res.send = (b) => { res.body = b; res.ended = true; return res; };
  res.end = (b) => { res.body = b; res.ended = true; return res; };
  return res;
}
const UA = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120';
const mkReq = (o = {}) => ({
  method: 'POST',
  headers: { origin: 'https://www.itskeerthan.com', 'x-forwarded-for': '1.2.3.4', 'user-agent': UA },
  socket: { remoteAddress: '127.0.0.1' },
  body: { e: 'view' },
  query: {},
  ...o,
});
const ENV = { UPSTASH_REDIS_REST_URL: 'https://r.example', UPSTASH_REDIS_REST_TOKEN: 'tok', ANALYTICS_SALT: 's', NODE_ENV: 'production' };
const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);

function setup(envOver = {}, fetchOver) {
  const bodies = [];
  const calls = [];
  let t = T0;
  const fetchImpl = fetchOver || (async (url, init) => {
    calls.push({ url, init });
    bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => bodies[bodies.length - 1].map(() => ({ result: 1 })) };
  });
  const env = { ...ENV, ...envOver };
  return {
    handler: createTrackHandler({ fetchImpl, env, now: () => t }),
    bodies, calls, clock: { set: (x) => { t = x; } },
  };
}
const flat = (bodies) => bodies.flat();
const has = (bodies, cmd) => flat(bodies).some((c) => JSON.stringify(c) === JSON.stringify(cmd));

test('EVENTS list', () => {
  assert.deepStrictEqual(EVENTS, ['view', 'talk-click', 'call-connected', 'call-offline', 'call-ended', 'question']);
});

test('redisFromEnv: null when unset, KV fallback, posts pipeline', async () => {
  assert.strictEqual(redisFromEnv({}, async () => {}), null);
  const seen = [];
  const r = redisFromEnv({ KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'k' }, async (url, init) => {
    seen.push({ url, init });
    return { ok: true, json: async () => [{ result: 5 }] };
  });
  const out = await r.pipeline([['PFCOUNT', 'x']]);
  assert.strictEqual(seen[0].url, 'https://kv.example/pipeline');
  assert.strictEqual(seen[0].init.headers.Authorization, 'Bearer k');
  assert.deepStrictEqual(JSON.parse(seen[0].init.body), [['PFCOUNT', 'x']]);
  assert.deepStrictEqual(out, [{ result: 5 }]);
});

test('valid view -> 204 and pipeline commands', async () => {
  const { handler, bodies } = setup();
  const res = mkRes();
  await handler(mkReq(), res);
  assert.strictEqual(res.statusCode, 204);
  assert.ok(has(bodies, ['HINCRBY', 'day:2026-11-21', 'view', 1]));
  assert.ok(has(bodies, ['EXPIRE', 'day:2026-11-21', 8640000]));
  assert.ok(has(bodies, ['EXPIRE', 'uv:2026-11-21', 8640000]));
  const pf = flat(bodies).find((c) => c[0] === 'PFADD');
  assert.strictEqual(pf[1], 'uv:2026-11-21');
  assert.match(pf[2], /^[0-9a-f]{16}$/);
  assert.ok(!JSON.stringify(bodies).includes('1.2.3.4'));
  assert.ok(!JSON.stringify(bodies).includes('Mozilla'));
});

test('hash differs across days for same ip/ua', async () => {
  const { handler, bodies, clock } = setup();
  await handler(mkReq(), mkRes());
  clock.set(T0 + 24 * 3600 * 1000);
  await handler(mkReq(), mkRes());
  const hashes = flat(bodies).filter((c) => c[0] === 'PFADD').map((c) => c[2]);
  assert.strictEqual(hashes.length, 2);
  assert.notStrictEqual(hashes[0], hashes[1]);
});

test('ignored: unknown event, bot UA, empty UA, bad origin -> 204, no redis', async () => {
  const { handler, calls } = setup();
  for (const req of [
    mkReq({ body: { e: 'nope' } }),
    mkReq({ headers: { origin: 'https://www.itskeerthan.com', 'user-agent': 'Googlebot/2.1' } }),
    mkReq({ headers: { origin: 'https://www.itskeerthan.com' } }),
    mkReq({ headers: { origin: 'https://evil.example', 'user-agent': UA } }),
  ]) {
    const res = mkRes();
    await handler(req, res);
    assert.strictEqual(res.statusCode, 204);
  }
  assert.strictEqual(calls.length, 0);
});

test('GET -> 405', async () => {
  const { handler } = setup();
  const res = mkRes();
  await handler(mkReq({ method: 'GET' }), res);
  assert.strictEqual(res.statusCode, 405);
});

test('props whitelist', async () => {
  const { handler, bodies } = setup();
  const res = mkRes();
  await handler(mkReq({ body: { e: 'call-offline', p: { kind: 'agent', evil: 'x', via: 'shout' } } }), res);
  assert.strictEqual(res.statusCode, 204);
  const incr = flat(bodies).filter((c) => c[0] === 'HINCRBY').map((c) => c[2]);
  assert.deepStrictEqual(incr, ['call-offline', 'call-offline:kind=agent']);
});

test('rate limit: 61st event makes no redis call', async () => {
  const { handler, calls } = setup();
  for (let i = 0; i < 60; i++) await handler(mkReq({ body: { e: 'talk-click' } }), mkRes());
  assert.strictEqual(calls.length, 60);
  const res = mkRes();
  await handler(mkReq({ body: { e: 'talk-click' } }), res);
  assert.strictEqual(res.statusCode, 204);
  assert.strictEqual(calls.length, 60);
});

test('no redis env -> 204', async () => {
  const handler = createTrackHandler({ fetchImpl: async () => { throw new Error('no'); }, env: { NODE_ENV: 'production' }, now: () => T0 });
  const res = mkRes();
  await handler(mkReq(), res);
  assert.strictEqual(res.statusCode, 204);
});

test('redis failure -> 204', async () => {
  const { handler } = setup({}, async () => { throw new Error('boom'); });
  const res = mkRes();
  await handler(mkReq(), res);
  assert.strictEqual(res.statusCode, 204);
});

function statsSetup(envOver = {}) {
  const fetchImpl = async (url, init) => {
    const cmds = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => cmds.map((c) => {
        if (c[0] === 'PFCOUNT') return { result: 7 };
        // HGETALL -> flat array
        return { result: ['view', '10', 'talk-click', '4', 'call-connected', '3', 'call-ended:secs=<15', '2', 'question', '5'] };
      }),
    };
  };
  const handler = createStatsHandler({ fetchImpl, env: { ...ENV, STATS_KEY: 'sekret', ...envOver }, now: () => T0 });
  return handler;
}

test('stats: wrong/missing key -> 404', async () => {
  for (const q of [{}, { key: 'x' }]) {
    const res = mkRes();
    await statsSetup()(mkReq({ method: 'GET', query: q }), res);
    assert.strictEqual(res.statusCode, 404);
  }
  const res = mkRes();
  await statsSetup({ STATS_KEY: '' })(mkReq({ method: 'GET', query: { key: '' } }), res);
  assert.strictEqual(res.statusCode, 404);
});

test('stats: json 30 rows newest first with click rate', async () => {
  const res = mkRes();
  await statsSetup()(mkReq({ method: 'GET', query: { key: 'sekret', format: 'json' } }), res);
  assert.strictEqual(res.statusCode, 200);
  const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  assert.strictEqual(data.days.length, 30);
  assert.strictEqual(data.days[0].date, '2026-11-21');
  assert.strictEqual(data.days[1].date, '2026-11-20');
  assert.strictEqual(data.days[0].visitors, 7);
  assert.strictEqual(data.days[0].views, 10);
  assert.strictEqual(data.days[0].talkClicks, 4);
  assert.strictEqual(data.days[0].clickRate, 40);
  assert.strictEqual(data.days[0].lengths['<15'], 2);
});

test('stats: json includes token count', async () => {
  const fetchImpl = async (url, init) => ({ ok: true, json: async () => JSON.parse(init.body).map((c) => c[0] === 'PFCOUNT' ? { result: 1 } : { result: ['token', '6'] }) });
  const h = createStatsHandler({ fetchImpl, env: { ...ENV, STATS_KEY: 'k' }, now: () => T0 });
  const res = mkRes();
  await h(mkReq({ method: 'GET', query: { key: 'k', format: 'json' } }), res);
  const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  assert.strictEqual(data.days[0].tokens, 6);
  assert.strictEqual(data.totals.tokens, 180);
});

test('production without salt -> event counted, no PFADD', async () => {
  const { handler, bodies } = setup({ ANALYTICS_SALT: '' });
  const res = mkRes();
  await handler(mkReq(), res);
  assert.strictEqual(res.statusCode, 204);
  assert.ok(has(bodies, ['HINCRBY', 'day:2026-11-21', 'view', 1]));
  assert.ok(!flat(bodies).some((c) => c[0] === 'PFADD'));
});

test('dev without salt still PFADDs', async () => {
  const { handler, bodies } = setup({ ANALYTICS_SALT: '', NODE_ENV: 'development' });
  await handler(mkReq({ headers: { origin: 'http://localhost:3000', 'user-agent': UA } }), mkRes());
  assert.ok(flat(bodies).some((c) => c[0] === 'PFADD'));
});

test('token route: hanging redis still returns 200 within timeout', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('deepgram')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 30 }) };
    return new Promise(() => {});
  };
  const handler = createTokenHandler({ fetchImpl, env: { ...ENV, DEEPGRAM_API_KEY: 'k' }, now: () => T0 });
  const res = mkRes();
  const t = Date.now();
  await handler(mkReq(), res);
  assert.strictEqual(res.statusCode, 200);
  assert.ok(Date.now() - t < 1500);
});

test('stats: html has table and caption', async () => {
  const res = mkRes();
  await statsSetup()(mkReq({ method: 'GET', query: { key: 'sekret' } }), res);
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.strictEqual(res.headers['x-robots-tag'], 'noindex');
  assert.match(res.body, /<table/);
  assert.match(res.body, /<caption>/);
  assert.strictEqual((res.body.match(/<h1/g) || []).length, 1);
});

test('token route: grant triggers one HINCRBY token; redis failure keeps 200', async () => {
  for (const redisFails of [false, true]) {
    const redisBodies = [];
    const fetchImpl = async (url, init) => {
      if (url.includes('deepgram')) return { ok: true, status: 200, json: async () => ({ access_token: 't', expires_in: 30 }) };
      if (redisFails) throw new Error('down');
      redisBodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => [] };
    };
    const handler = createTokenHandler({ fetchImpl, env: { ...ENV, DEEPGRAM_API_KEY: 'k' }, now: () => T0 });
    const res = mkRes();
    await handler(mkReq(), res);
    assert.strictEqual(res.statusCode, 200);
    if (!redisFails) {
      const incr = redisBodies.flat().filter((c) => c[0] === 'HINCRBY');
      assert.deepStrictEqual(incr, [['HINCRBY', 'day:2026-11-21', 'token', 1]]);
    }
  }
});
