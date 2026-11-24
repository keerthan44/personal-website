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
  assert.deepStrictEqual(EVENTS, ['view', 'talk-click', 'book-click', 'call-connected', 'call-offline', 'call-ended', 'question']);
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
  assert.ok(has(bodies, ['HINCRBY', 'development:day:2026-11-21', 'view', 1]));
  assert.ok(has(bodies, ['EXPIRE', 'development:day:2026-11-21', 8640000]));
  assert.ok(has(bodies, ['EXPIRE', 'development:uv:2026-11-21', 8640000]));
  const pf = flat(bodies).find((c) => c[0] === 'PFADD');
  assert.strictEqual(pf[1], 'development:uv:2026-11-21');
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

test('stats: json 30 rows newest first with click rate', async () => {
  const res = mkRes();
  await statsSetup()(mkReq({ method: 'GET', headers: { authorization: 'Bearer sekret' }, query: { format: 'json' } }), res);
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
  await h(mkReq({ method: 'GET', headers: { authorization: 'Bearer k' }, query: { format: 'json' } }), res);
  const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  assert.strictEqual(data.days[0].tokens, 6);
  assert.strictEqual(data.totals.tokens, 180);
});

test('production without salt -> event counted, no PFADD', async () => {
  const { handler, bodies } = setup({ ANALYTICS_SALT: '' });
  const res = mkRes();
  await handler(mkReq(), res);
  assert.strictEqual(res.statusCode, 204);
  assert.ok(has(bodies, ['HINCRBY', 'development:day:2026-11-21', 'view', 1]));
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
  await statsSetup()(mkReq({ method: 'GET', headers: { authorization: 'Bearer sekret' }, query: {} }), res);
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
      assert.deepStrictEqual(incr, [['HINCRBY', 'development:day:2026-11-21', 'token', 1]]);
    }
  }
});

test('envName: VERCEL_ENV or development', async () => {
  const { envName } = await import('../../voice-agent/analytics.mjs');
  assert.strictEqual(envName({}), 'development');
  assert.strictEqual(envName({ VERCEL_ENV: 'production' }), 'production');
  assert.strictEqual(envName({ VERCEL_ENV: 'preview' }), 'preview');
  assert.strictEqual(envName({ VERCEL_ENV: 'development' }), 'development');
  assert.strictEqual(envName({ VERCEL_ENV: 'weird' }), 'development');
});

test('track: production and preview events land in different keys', async () => {
  const prod = setup({ VERCEL_ENV: 'production' });
  await prod.handler(mkReq(), mkRes());
  assert.ok(has(prod.bodies, ['HINCRBY', 'production:day:2026-11-21', 'view', 1]));
  assert.strictEqual(flat(prod.bodies).find((c) => c[0] === 'PFADD')[1], 'production:uv:2026-11-21');
  const prev = setup({ VERCEL_ENV: 'preview' });
  await prev.handler(mkReq(), mkRes());
  assert.ok(has(prev.bodies, ['HINCRBY', 'preview:day:2026-11-21', 'view', 1]));
  assert.strictEqual(flat(prev.bodies).find((c) => c[0] === 'PFADD')[1], 'preview:uv:2026-11-21');
  assert.ok(!flat(prev.bodies).some((c) => String(c[1]).startsWith('production:')));
});

function statsKeys(envOver, query) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const cmds = JSON.parse(init.body);
    seen.push(...cmds);
    return { ok: true, json: async () => cmds.map((c) => (c[0] === 'PFCOUNT' ? { result: 0 } : { result: [] })) };
  };
  const h = createStatsHandler({ fetchImpl, env: { ...ENV, STATS_KEY: 'k', ...envOver }, now: () => T0 });
  return { h, seen, run: async () => { const res = mkRes(); await h(mkReq({ method: 'GET', headers: { authorization: 'Bearer k' }, query: { ...query } }), res); return res; } };
}

test('stats: ?env=preview reads only preview keys and reports env', async () => {
  const s = statsKeys({ VERCEL_ENV: 'production' }, { env: 'preview', format: 'json' });
  const res = await s.run();
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.env, 'preview');
  assert.ok(s.seen.length > 0);
  assert.ok(s.seen.every((c) => c[1].startsWith('preview:')), JSON.stringify(s.seen.slice(0, 2)));
});

test('stats: defaults to the deployment env; bad env param falls back', async () => {
  const a = statsKeys({ VERCEL_ENV: 'production' }, { format: 'json' });
  const r1 = await a.run();
  assert.strictEqual(r1.body.env, 'production');
  assert.ok(a.seen.every((c) => c[1].startsWith('production:')));
  const b = statsKeys({}, { format: 'json', env: 'evil' });
  const r2 = await b.run();
  assert.strictEqual(r2.body.env, 'development');
});

test('stats: html names the env and links to the others without the key', async () => {
  const s = statsKeys({ VERCEL_ENV: 'production' }, {});
  const res = await s.run();
  assert.match(res.body, /<h1[^>]*>[^<]*production/i);
  assert.match(res.body, /href="\?env=preview"/);
  assert.match(res.body, /href="\?env=development"/);
  assert.ok(!res.body.includes('key=k'), 'key never appears in a link');
  assert.match(res.body, /name="action" value="logout"/);
});

test('country: counted for view, talk-click and book-click from the Vercel header', async () => {
  const { handler, bodies } = setup();
  for (const e of ['view', 'talk-click', 'book-click']) {
    const req = mkReq({ body: { e } });
    req.headers['x-vercel-ip-country'] = 'DE';
    await handler(req, mkRes());
    assert.ok(has(bodies, ['HINCRBY', 'development:day:2026-11-21', `${e}:country=DE`, 1]), e);
  }
});

test('country: ignored for other events, junk values and missing header', async () => {
  const { handler, bodies } = setup();
  const q = mkReq({ body: { e: 'question', p: { via: 'voice' } } });
  q.headers['x-vercel-ip-country'] = 'DE';
  await handler(q, mkRes());
  for (const bad of ['de', 'XYZ', '<b>', '']) {
    const r = mkReq({ body: { e: 'view' } });
    r.headers['x-vercel-ip-country'] = bad;
    await handler(r, mkRes());
  }
  await handler(mkReq({ body: { e: 'view' } }), mkRes());
  assert.ok(!flat(bodies).some((c) => String(c[2]).includes('country=')));
});

test('stats: book clicks and a by-country breakdown sorted by clicks', async () => {
  const fetchImpl = async (url, init) => ({ ok: true, json: async () => JSON.parse(init.body).map((c) => c[0] === 'PFCOUNT' ? { result: 1 } : { result: [
    'view', '5', 'book-click', '2',
    'view:country=IN', '3', 'talk-click:country=IN', '1',
    'view:country=US', '2', 'talk-click:country=US', '1', 'book-click:country=US', '2',
  ] }) });
  const h = createStatsHandler({ fetchImpl, env: { ...ENV, STATS_KEY: 'k' }, now: () => T0 });
  const res = mkRes();
  await h(mkReq({ method: 'GET', headers: { authorization: 'Bearer k' }, query: { format: 'json' } }), res);
  const data = typeof res.body === 'string' ? JSON.parse(res.body) : res.body;
  assert.strictEqual(data.days[0].bookClicks, 2);
  assert.strictEqual(data.totals.bookClicks, 60);
  assert.deepStrictEqual(data.countries[0], { code: 'US', views: 60, talkClicks: 30, bookClicks: 60 });
  assert.deepStrictEqual(data.countries[1], { code: 'IN', views: 90, talkClicks: 30, bookClicks: 0 });
  const html = mkRes();
  await h(mkReq({ method: 'GET', headers: { authorization: 'Bearer k' }, query: {} }), html);
  assert.ok(html.body.includes('Book clicks'));
  assert.ok(html.body.includes('United States'));
});

/* ---------- stats auth: the key never travels in a URL ---------- */
const cookieOf = (res) => String(res.headers['set-cookie'] || '').split(';')[0];
const getStats = (h, o = {}) => { const res = mkRes(); return h(mkReq({ method: 'GET', headers: {}, query: {}, ...o }), res).then(() => res); };

test('stats: unconfigured key -> 404', async () => {
  const res = await getStats(statsSetup({ STATS_KEY: '' }));
  assert.strictEqual(res.statusCode, 404);
});

test('stats: a key in the URL is ignored; you get the sign-in form, no data', async () => {
  const res = await getStats(statsSetup(), { query: { key: 'sekret' } });
  assert.strictEqual(res.statusCode, 200);
  assert.match(res.body, /type="password"/);
  assert.match(res.body, /method="post"/);
  assert.ok(!/<table/.test(res.body));
  assert.strictEqual(res.headers['referrer-policy'], 'no-referrer');
});

test('stats: json without credentials -> 401, wrong bearer -> 401', async () => {
  assert.strictEqual((await getStats(statsSetup(), { query: { format: 'json' } })).statusCode, 401);
  assert.strictEqual((await getStats(statsSetup(), { headers: { authorization: 'Bearer nope' }, query: { format: 'json' } })).statusCode, 401);
});

test('stats: signing in with a POSTed key sets a scoped HttpOnly cookie and redirects', async () => {
  const h = statsSetup();
  const res = mkRes();
  await h(mkReq({ method: 'POST', headers: {}, body: { key: 'sekret' } }), res);
  assert.strictEqual(res.statusCode, 303);
  assert.strictEqual(res.headers.location, '/api/stats');
  const c = String(res.headers['set-cookie']);
  assert.match(c, /^stats_session=\d+\.[\w-]+;/);
  assert.match(c, /Path=\/api\/stats/); assert.match(c, /HttpOnly/); assert.match(c, /SameSite=Strict/); assert.match(c, /Secure/);
  assert.ok(!c.includes('sekret'), 'cookie never contains the key');
  const page = await getStats(h, { headers: { cookie: cookieOf(res) } });
  assert.strictEqual(page.statusCode, 200);
  assert.match(page.body, /<table/);
});

test('stats: wrong POSTed key -> 401 with the form and an error', async () => {
  const res = mkRes();
  await statsSetup()(mkReq({ method: 'POST', headers: {}, body: { key: 'wrong' } }), res);
  assert.strictEqual(res.statusCode, 401);
  assert.match(res.body, /role="alert"/);
  assert.ok(!res.headers['set-cookie']);
});

test('stats: tampered, expired, or other-key sessions are rejected', async () => {
  const h = statsSetup();
  const login = mkRes();
  await h(mkReq({ method: 'POST', headers: {}, body: { key: 'sekret' } }), login);
  const good = cookieOf(login).split('=')[1];
  const [exp, mac] = good.split('.');
  for (const bad of [`${Number(exp) + 99999}.${mac}`, `${exp}.x${mac.slice(1)}`, 'garbage', '']) {
    const res = await getStats(h, { headers: { cookie: `stats_session=${bad}` } });
    assert.ok(!/<table/.test(res.body), bad);
  }
  const later = createStatsHandler({ fetchImpl: async () => ({ ok: true, json: async () => [] }), env: { ...ENV, STATS_KEY: 'sekret' }, now: () => T0 + 13 * 3600 * 1000 });
  assert.ok(!/<table/.test((await getStats(later, { headers: { cookie: `stats_session=${good}` } })).body), 'expires after 12h');
  const rotated = statsSetup({ STATS_KEY: 'new-key' });
  assert.ok(!/<table/.test((await getStats(rotated, { headers: { cookie: `stats_session=${good}` } })).body), 'rotating the key signs everyone out');
});

test('stats: sign out clears the cookie', async () => {
  const res = mkRes();
  await statsSetup()(mkReq({ method: 'POST', headers: {}, body: { action: 'logout' } }), res);
  assert.strictEqual(res.statusCode, 303);
  assert.match(String(res.headers['set-cookie']), /^stats_session=; .*Max-Age=0/);
});
