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
    for (const k of ['office', 'start']) assert.ok(m[k], `seed ${seed}: missing ${k}`);
    assert.ok(m.stations.length >= 1, `seed ${seed}: police station`);
    assert.ok(m.office.wicket, `seed ${seed}: side wicket`);
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

test('every town has a canal with two bridges, Bazaar Street stalls and Gandhi Circle (40 seeds)', () => {
  for (let s = 1; s <= 40; s++) {
    const m = W.generateTown(W.hashStr('town' + s));
    const cols = new Set();
    for (let i = 0; i < m.t.length; i++) if (m.t[i] === K.BRIDGE) cols.add(i % N);
    const spans = [...cols].sort((a, b) => a - b).filter((c, k, a) => k === 0 || a[k - 1] !== c - 1);
    assert.equal(spans.length, 2, `seed ${s}: bridges`);
    assert.ok(m.t.some((k) => k === K.WATER), `seed ${s}: canal`);
    assert.ok(m.buildings.filter((b) => b.kind === 'stall').length >= 8, `seed ${s}: stalls`);
    assert.ok(m.buildings.some((b) => b.kind === 'statue'), `seed ${s}: Gandhi Circle`);
    assert.ok(m.t.some((k) => k === K.PALM), `seed ${s}: palms on the edge`);
    // the walk winds a little but stays short, and there are two ways across the canal
    const target = tileOf(m.office), [sx, sy] = tileOf(m.start);
    const f = W.field(m, [target]);
    const walk = f[sy * N + sx], straight = Math.abs(sx - target[0]) + Math.abs(sy - target[1]);
    assert.ok(walk >= straight && walk < straight + 40, `seed ${s}: walk ${walk} vs ${straight}`);
    for (const c of spans) {
      const dyn = new Uint8Array(N * N);
      for (let i = 0; i < m.t.length; i++) if (m.t[i] === K.BRIDGE && i % N >= c && i % N <= c + 2) dyn[i] = 1;
      const g = W.field(Object.assign({}, m, { dyn }), [target]);
      assert.ok(g[sy * N + sx] > 0, `seed ${s}: office still reachable with the bridge at ${c} closed`);
    }
  }
});

test('bodies collide with buildings and slide along walls', () => {
  const m = W.generateTown(5);
  // a house with open ground on its left, and room to slide down that side
  const b = m.buildings.find((x) => {
    if (x.kind !== 'house' || x.w < 3 * TILE || x.h < 3 * TILE) return false;
    const lx = x.x / TILE - 1, my = Math.floor((x.y + x.h / 2) / TILE);
    return !W.solidAt(m, lx, my) && !W.solidAt(m, lx, my + 1) && !W.solidAt(m, lx - 1, my);
  });
  assert.ok(b, 'found a house beside a street');
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
  const ring = W.barricadeRing(m, m.office.x, m.office.y, 11);
  assert.ok(ring.length >= 3);
  for (const g of ring) for (const j of g.tiles) assert.ok([K.ROAD, K.WALK, K.BRIDGE].includes(m.t[j]));
});
