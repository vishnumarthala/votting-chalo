'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const W = require('../shared/world.js');
const { convertFile } = require('../scripts/osm-to-town.js');
const { townData } = require('./towns.js');
const { N, TILE, K } = W;

const tileOf = (p) => [Math.floor(p.x / TILE), Math.floor(p.y / TILE)];

test('T-2 road classes are drawn 3, 2 and 1 tiles wide and footways are not drawn', () => {
  const data = convertFile(path.join(__dirname, 'fixtures', 'mini.osm'), { centre: [14.4, 78.2], size: 500 });
  const m = W.buildTown(data);
  const perTile = data.size / N; // metres per tile: 500 m over 128 tiles

  // a column 50 m west of the centre crosses all three parallel roads and nothing else
  const col = Math.floor((data.size / 2 - 50) / perTile);
  const runs = [];
  for (let y = 0, run = 0; y <= N; y++) {
    if (y < N && m.t[y * N + col] === K.ROAD) run++;
    else if (run) { runs.push(run); run = 0; }
  }
  assert.deepEqual(runs, [3, 2, 1], 'primary 3, tertiary 2, residential 1 (north to south)');

  // the footway runs 100 m east of the centre between the tertiary and the residential road
  const fcol = Math.floor((data.size / 2 + 100) / perTile);
  for (let y = Math.floor((data.size / 2 + 30) / perTile); y <= Math.floor((data.size / 2 + 120) / perTile); y++) {
    assert.notEqual(m.t[y * N + fcol], K.ROAD, `footway tile ${fcol},${y} is a road`);
  }
});

test('T-3 Pulivendula has every site, reachable and clear, on a road network that follows the mapped centre-lines, and builds identically twice', () => {
  const data = townData('pulivendula');
  const m = W.buildTown(data), again = W.buildTown(data);

  for (const k of ['office', 'booth', 'start', 'blo']) assert.ok(m[k], `missing ${k}`);
  assert.equal(m.docSites.length, W.DOC_SHOPS.length, 'five document shops');
  assert.ok(m.stations.length >= 3, 'police stations');
  assert.ok(m.posts.length >= 1, 'patrol posts');

  const f = W.field(m, [tileOf(m.start)]);
  for (const site of m.sites) {
    const [tx, ty] = tileOf(site);
    assert.ok(f[ty * N + tx] >= 0, `${site.kind} ${site.name} unreachable from the start`);
    assert.ok(!W.solidAt(m, tx, ty), `${site.name} stands on a solid tile`);
  }
  assert.ok(W.dist(m.start.x, m.start.y, m.office.x, m.office.y) > W.WORLD * 0.5, 'office is far from the start');

  for (const b of m.buildings) {
    if (b.solid === false) continue;
    for (let y = b.y / TILE; y < (b.y + b.h) / TILE; y++) for (let x = b.x / TILE; x < (b.x + b.w) / TILE; x++) {
      assert.equal(m.t[y * N + x], K.BUILD, `${b.kind} covers a ${m.t[y * N + x]} tile at ${x},${y}`);
    }
  }

  // tiles under the mapped trunk, primary and secondary centre-lines are road or bridge
  const perTile = data.size / N, under = new Set();
  for (const r of data.roads) {
    if (!['trunk', 'primary', 'secondary'].includes(r.class)) continue;
    for (let i = 1; i < r.pts.length; i++) {
      const [x0, y0] = r.pts[i - 1], [x1, y1] = r.pts[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (perTile / 2)));
      for (let s = 0; s <= steps; s++) {
        const tx = Math.min(N - 1, Math.floor((x0 + ((x1 - x0) * s) / steps) / perTile)), ty = Math.min(N - 1, Math.floor((y0 + ((y1 - y0) * s) / steps) / perTile));
        under.add(ty * N + tx);
      }
    }
  }
  let drawn = 0;
  for (const i of under) if (m.t[i] === K.ROAD || m.t[i] === K.BRIDGE) drawn++;
  assert.ok(under.size > 50, 'the town has major roads');
  assert.ok(drawn / under.size >= 0.8, `${drawn} of ${under.size} tiles under major roads are road or bridge`);

  assert.deepEqual(Buffer.from(m.t), Buffer.from(again.t), 'same tiles');
  assert.deepEqual(m.sites, again.sites, 'same sites');
});

test('bodies collide with buildings and slide along walls', () => {
  const m = W.buildTown(townData('pulivendula'));
  const solid = (tx, ty) => W.solidAt(m, tx, ty);
  const b = m.buildings.find((x) => {
    if (x.kind !== 'house' || x.solid === false) return false;
    const tx = x.x / TILE, ty = x.y / TILE, th = x.h / TILE;
    for (let dy = -1; dy <= th; dy++) for (let dx = 1; dx <= 3; dx++) if (solid(tx - dx, ty + dy)) return false;
    return true;
  });
  assert.ok(b, 'a house with open ground on its west side');
  const body = { x: b.x - 20, y: b.y + b.h / 2, r: 9 };
  for (let i = 0; i < 30; i++) W.moveBody(body, 6, 0, m);
  assert.ok(body.x + body.r <= b.x + 0.001, 'stopped at the wall');
  const y0 = body.y;
  W.moveBody(body, 6, 6, m);
  assert.ok(body.y > y0, 'slid along the wall');
});

test('flow fields lead to the target and line of sight is blocked by buildings', () => {
  const m = W.buildTown(townData('pulivendula'));
  const f = W.field(m, [tileOf(m.office)]);
  const p = { x: m.start.x, y: m.start.y, r: 9 };
  for (let i = 0; i < 6000 && W.dist(p.x, p.y, m.office.x, m.office.y) > 40; i++) {
    const d = W.flowDir(m, f, p.x, p.y);
    if (!d) break;
    W.moveBody(p, d.x * 6, d.y * 6, m);
  }
  assert.ok(W.dist(p.x, p.y, m.office.x, m.office.y) <= 48, 'walked to the office');
  const b = m.buildings.find((x) => x.kind === 'house' && x.solid !== false);
  assert.equal(W.lineOfSight(m, b.x - 20, b.y + b.h / 2, b.x + b.w + 20, b.y + b.h / 2), false);
});

test('barricade ring groups cross streets around the target', () => {
  const m = W.buildTown(townData('pulivendula'));
  const ring = W.barricadeRing(m, m.office.x, m.office.y, 15);
  assert.ok(ring.length >= 3);
  for (const g of ring) for (const j of g.tiles) assert.ok([K.ROAD, K.WALK, K.BRIDGE].includes(m.t[j]));
});
