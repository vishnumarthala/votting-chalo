'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../api/stats.js');

function call(handler, method, body) {
  return new Promise((resolve) => {
    const res = { statusCode: 0, setHeader() {}, end(s) { resolve({ status: this.statusCode, json: JSON.parse(s) }); } };
    handler({ method, body }, res);
  });
}

test('counts games in total and per day, and unique players', async () => {
  let now = Date.UTC(2026, 9, 19, 10);
  const h = S.makeHandler(S.memoryStore(), () => now);
  await call(h, 'POST', { id: 'device-aaaaaaaa' });
  await call(h, 'POST', { id: 'device-aaaaaaaa' }); // play again
  await call(h, 'POST', { id: 'device-bbbbbbbb' });
  let r = (await call(h, 'GET')).json;
  assert.deepEqual([r.games, r.gamesToday, r.players], [3, 3, 2]);
  now += 24 * 3600 * 1000;
  await call(h, 'POST', { id: 'device-cccccccc' });
  r = (await call(h, 'GET')).json;
  assert.deepEqual([r.games, r.gamesToday, r.players, r.day], [4, 1, 3, '2026-10-20']);
});

test('rejects bad ids, and says when it is not configured', async () => {
  const h = S.makeHandler(S.memoryStore());
  assert.equal((await call(h, 'POST', { id: 'x' })).status, 400);
  assert.equal((await call(h, 'PUT')).status, 405);
  assert.equal((await call(S.makeHandler(null), 'GET')).status, 503);
});

test('the Redis store uses one pipeline per game: two counters and a HyperLogLog', async () => {
  const sent = [];
  const store = S.upstashStore('https://redis.example', 't', async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => [{ result: '41' }, { result: '7' }, { result: 30 }] };
  });
  const h = S.makeHandler(store, () => Date.UTC(2026, 9, 19));
  await call(h, 'POST', { id: 'device-aaaaaaaa' });
  assert.deepEqual(sent[0], [['INCR', 'stats:games'], ['INCR', 'stats:games:2026-10-19'], ['PFADD', 'stats:players', 'device-aaaaaaaa']]);
  const r = (await call(h, 'GET')).json;
  assert.deepEqual([r.games, r.gamesToday, r.players], [41, 7, 30]);
});
