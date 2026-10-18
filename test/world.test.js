'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../shared/world.js');
const { N, TILE, K } = W;

const tileOf = (p) => [Math.floor(p.x / TILE), Math.floor(p.y / TILE)];

test('generation is deterministic per seed and differs between seeds', () => {
  const a = W.generateTown(42), b = W.generateTown(42), c = W.generateTown(43);
  assert.deepEqual(Buffer.from(a.t), Buffer.from(b.t));
  assert.notDeepEqual(Buffer.from(a.t), Buffer.from(c.t));
  assert.deepEqual(a.sites.map((s) => [s.kind, s.x, s.y]), b.sites.map((s) => [s.kind, s.x, s.y]));
});

test('every generated town has all sites, and all of them are reachable from the start (40 seeds)', () => {
  for (let s = 1; s <= 40; s++) {
    const seed = W.hashStr('seed' + s);
    const m = W.generateTown(seed);
    for (const k of ['office', 'booth', 'start', 'blo']) assert.ok(m[k], `seed ${seed}: missing ${k}`);
    assert.equal(m.docSites.length, W.DOC_SHOPS.length, `seed ${seed}: doc shops`);
    assert.ok(m.stations.length >= 3, `seed ${seed}: police stations`);
    const f = W.field(m, [tileOf(m.start)]);
    for (const site of m.sites) {
      const [tx, ty] = tileOf(site);
      assert.ok(f[ty * N + tx] >= 0, `seed ${seed}: ${site.kind} ${site.name} unreachable`);
      assert.ok(!W.solidAt(m, tx, ty), `seed ${seed}: ${site.name} stands on a solid tile`);
    }
    // the destination is far from the start
    assert.ok(W.dist(m.start.x, m.start.y, m.office.x, m.office.y) > W.WORLD * 0.5, `seed ${seed}: office too close`);
  }
});

test('buildings sit on solid tiles and never cover roads', () => {
  const m = W.generateTown(7);
  for (const b of m.buildings) {
    if (b.solid === false) continue;
    for (let y = b.y / TILE; y < (b.y + b.h) / TILE; y++) for (let x = b.x / TILE; x < (b.x + b.w) / TILE; x++) {
      assert.equal(m.t[y * N + x], K.BUILD, `${b.kind} at ${x},${y}`);
    }
  }
});

test('the canal is crossed by bridges', () => {
  const m = W.generateTown(99);
  let bridges = 0;
  for (const k of m.t) if (k === K.BRIDGE) bridges++;
  assert.ok(bridges > 10);
});

test('bodies collide with buildings and slide along walls', () => {
  const m = W.generateTown(5);
  const b = m.buildings.find((x) => x.kind === 'house' && x.w >= 3 * TILE);
  const body = { x: b.x - 20, y: b.y + b.h / 2, r: 9 };
  for (let i = 0; i < 30; i++) W.moveBody(body, 6, 0, m);
  assert.ok(body.x + body.r <= b.x + 0.001, 'stopped at the wall');
  const y0 = body.y;
  W.moveBody(body, 6, 6, m);
  assert.ok(body.y > y0, 'slid along the wall');
});

test('flow fields lead to the target and line of sight is blocked by buildings', () => {
  const m = W.generateTown(11);
  const f = W.field(m, [tileOf(m.office)]);
  const p = { x: m.start.x, y: m.start.y, r: 9 };
  for (let i = 0; i < 6000 && W.dist(p.x, p.y, m.office.x, m.office.y) > 40; i++) {
    const d = W.flowDir(m, f, p.x, p.y);
    if (!d) break;
    W.moveBody(p, d.x * 6, d.y * 6, m);
  }
  assert.ok(W.dist(p.x, p.y, m.office.x, m.office.y) <= 48, 'walked to the office');
  const b = m.buildings.find((x) => x.kind === 'house' && x.w >= 3 * TILE && x.h >= 3 * TILE);
  assert.equal(W.lineOfSight(m, b.x - 20, b.y + b.h / 2, b.x + b.w + 20, b.y + b.h / 2), false);
});

test('barricade ring groups cross streets around the target', () => {
  const m = W.generateTown(21);
  const ring = W.barricadeRing(m, m.office.x, m.office.y, 15);
  assert.ok(ring.length >= 3);
  for (const g of ring) for (const j of g.tiles) assert.ok([K.ROAD, K.WALK, K.BRIDGE].includes(m.t[j]));
});
