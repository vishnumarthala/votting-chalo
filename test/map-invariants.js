'use strict';
// Shared test helper: the map invariants every real town must keep (AC-1, AC-2), checked on a built map.
const assert = require('node:assert/strict');
const W = require('../shared/world.js');
const { N, TILE, K } = W;

const tileOf = (p) => [Math.floor(p.x / TILE), Math.floor(p.y / TILE)];

function checkMapInvariants(data, id) {
  const m = W.buildTown(data), again = W.buildTown(data);

  for (const k of ['office', 'booth', 'start', 'blo']) assert.ok(m[k], `${id}: missing ${k}`);
  assert.equal(m.docSites.length, W.DOC_SHOPS.length, `${id}: five document shops`);
  assert.ok(m.stations.length >= 3, `${id}: at least 3 police stations`);
  assert.ok(m.posts.length >= 1, `${id}: patrol posts`);

  const f = W.field(m, [tileOf(m.start)]);
  for (const site of m.sites) {
    const [tx, ty] = tileOf(site);
    assert.ok(f[ty * N + tx] >= 0, `${id}: ${site.kind} ${site.name} unreachable from the start`);
    assert.ok(!W.solidAt(m, tx, ty), `${id}: ${site.name} stands on a solid tile`);
  }
  assert.ok(W.dist(m.start.x, m.start.y, m.office.x, m.office.y) > W.WORLD * 0.5, `${id}: office is far from the start`);

  for (const b of m.buildings) {
    if (b.solid === false) continue;
    for (let y = b.y / TILE; y < (b.y + b.h) / TILE; y++) for (let x = b.x / TILE; x < (b.x + b.w) / TILE; x++) {
      assert.equal(m.t[y * N + x], K.BUILD, `${id}: ${b.kind} covers a ${m.t[y * N + x]} tile at ${x},${y}`);
    }
  }

  // at least 80% of the tiles under mapped trunk, primary and secondary centre-lines are road or bridge
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
  assert.ok(under.size > 50, `${id}: the town has major roads`);
  assert.ok(drawn / under.size >= 0.8, `${id}: ${drawn} of ${under.size} tiles under major roads are road or bridge`);

  assert.deepEqual(Buffer.from(m.t), Buffer.from(again.t), `${id}: same tiles`);
  assert.deepEqual(m.sites, again.sites, `${id}: same sites`);
  return m;
}

module.exports = { checkMapInvariants };
