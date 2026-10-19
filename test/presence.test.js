'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../api/presence.js');

function call(handler, method, body) {
  return new Promise((resolve) => {
    const req = { method, body };
    const res = {
      headers: {}, statusCode: 0,
      setHeader(k, v) { this.headers[k] = v; },
      end(s) { resolve({ status: this.statusCode, json: JSON.parse(s), headers: this.headers }); },
    };
    handler(req, res);
  });
}

test('counts tabs that pinged in the last 45 s; leaving and going quiet drop them', async () => {
  let now = 1e6;
  const h = P.makeHandler(P.memoryStore(), () => now);
  assert.equal((await call(h, 'POST', { id: 'tab-aaaaaaaa' })).json.online, 1);
  assert.equal((await call(h, 'POST', { id: 'tab-bbbbbbbb' })).json.online, 2);
  assert.equal((await call(h, 'POST', { id: 'tab-aaaaaaaa' })).json.online, 2, 'the same tab counts once');
  now += P.WINDOW_MS - 1000;
  assert.equal((await call(h, 'POST', { id: 'tab-cccccccc' })).json.online, 3);
  now += 2000; // a and b went quiet
  assert.equal((await call(h, 'POST', { id: 'tab-cccccccc' })).json.online, 1);
  assert.equal((await call(h, 'POST', { id: 'tab-cccccccc', leave: true })).json.online, 0);
});

test('rejects bad requests and says when it is not configured', async () => {
  const h = P.makeHandler(P.memoryStore());
  assert.equal((await call(h, 'GET')).status, 405);
  assert.equal((await call(h, 'POST', { id: 'x' })).status, 400);
  assert.equal((await call(h, 'POST', { id: 'has spaces in it' })).status, 400);
  assert.equal((await call(h, 'POST', '{not json')).status, 400);
  const off = await call(P.makeHandler(null), 'POST', { id: 'tab-aaaaaaaa' });
  assert.equal(off.status, 503);
  assert.equal(off.headers['cache-control'], 'no-store');
});

test('the Redis store adds the tab and counts the window in one pipeline', async () => {
  const sent = [];
  const store = P.upstashStore('https://redis.example/', 'secret', async (url, init) => {
    sent.push({ url, auth: init.headers.authorization, cmds: JSON.parse(init.body) });
    return { ok: true, json: async () => [{ result: 1 }, { result: 7 }] };
  });
  const h = P.makeHandler(store, () => 100000);
  const r = await call(h, 'POST', { id: 'tab-aaaaaaaa' });
  assert.equal(r.json.online, 7);
  assert.equal(sent[0].url, 'https://redis.example/pipeline');
  assert.equal(sent[0].auth, 'Bearer secret');
  assert.deepEqual(sent[0].cmds.slice(0, 2), [['ZADD', 'presence:online', '100000', 'tab-aaaaaaaa'], ['ZCOUNT', 'presence:online', String(100000 - P.WINDOW_MS), '+inf']]);
  const down = P.makeHandler(P.upstashStore('https://r', 't', async () => ({ ok: false, status: 500 })));
  assert.equal((await call(down, 'POST', { id: 'tab-aaaaaaaa' })).status, 502);
});
