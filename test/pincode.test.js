'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../client/pincode.js');

const office = (o) => Object.assign({ Name: 'Main', Block: 'Guntur', District: 'Guntur', State: 'Andhra Pradesh', DeliveryStatus: 'Non-Delivery' }, o);
const ok = (offices) => [{ Message: 'x', Status: 'Success', PostOffice: offices }];
const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), map: m }; };
const fakeFetch = (body, status) => { let calls = 0; const f = async () => { calls++; return { ok: (status || 200) < 400, status: status || 200, json: async () => body }; }; f.calls = () => calls; return f; };

test('validate accepts 6 digits only', () => {
  assert.deepEqual(P.validate(' 522 001 '), { ok: true, pin: '522001' });
  assert.equal(P.validate('52200').ok, false);
  assert.equal(P.validate('022001').ok, false);
  assert.equal(P.validate('52a001').ok, false);
  assert.equal(P.validate(null).ok, false);
});

test('parseResponse prefers a delivery office and strips parenthetical suffixes', () => {
  const r = P.parseResponse(ok([office({ Name: 'Bus Stand(Guntur)' }), office({ Name: 'Kothapeta', DeliveryStatus: 'Delivery' })]), '522001');
  assert.equal(r.ok, true);
  assert.deepEqual([r.place.town, r.place.mandal, r.place.district], ['Kothapeta', 'Guntur', 'Guntur']);
  assert.deepEqual(r.place.offices, ['Bus Stand', 'Kothapeta']);
});

test('parseResponse falls back to district when the block is NA', () => {
  const r = P.parseResponse(ok([office({ Block: 'NA', District: 'Krishna', Name: 'Gudivada' })]), '521301');
  assert.equal(r.place.mandal, 'Krishna');
});

test('parseResponse rejects other states, unknown pins and malformed payloads', () => {
  const tg = P.parseResponse(ok([office({ State: 'Telangana' })]), '500001');
  assert.equal(tg.ok, false); assert.equal(tg.reason, 'state'); assert.match(tg.message, /Telangana/);
  const nf = P.parseResponse([{ Status: 'Error', PostOffice: null }], '999999');
  assert.equal(nf.reason, 'notfound');
  assert.equal(P.parseResponse({}, '1').reason, 'malformed');
  assert.equal(P.parseResponse(null, '1').reason, 'malformed');
});

test('fallback covers AP prefixes only', () => {
  assert.equal(P.fallback('533101').place.district, 'East Godavari');
  assert.equal(P.fallback('533101').place.approximate, true);
  assert.equal(P.fallback('500001').ok, false);
});

test('lookup uses the network once, then the cache', async () => {
  const storage = memStorage();
  const f = fakeFetch(ok([office({ Name: 'Rajahmundry', Block: 'Rajahmundry', District: 'East Godavari', DeliveryStatus: 'Delivery' })]));
  const a = await P.lookup('533101', { fetch: f, storage });
  assert.equal(a.ok, true); assert.equal(a.place.source, 'indiapost');
  const b = await P.lookup('533101', { fetch: f, storage });
  assert.equal(b.cached, true); assert.equal(b.place.town, 'Rajahmundry');
  assert.equal(f.calls(), 1);
});

test('lookup falls back on network errors and HTTP failures, but not for wrong states', async () => {
  const boom = async () => { throw new Error('offline'); };
  const r1 = await P.lookup('522001', { fetch: boom });
  assert.equal(r1.ok, true); assert.equal(r1.place.source, 'fallback'); assert.match(r1.warning, /offline/);
  const r2 = await P.lookup('530001', { fetch: fakeFetch(null, 503) });
  assert.equal(r2.place.district, 'Visakhapatnam'); assert.match(r2.warning, /503/);
  const r3 = await P.lookup('500001', { fetch: fakeFetch(ok([office({ State: 'Telangana' })])) });
  assert.equal(r3.ok, false); assert.equal(r3.reason, 'state');
  const r4 = await P.lookup('12', { fetch: boom });
  assert.equal(r4.reason, 'format');
});
