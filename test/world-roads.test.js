'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const W = require('../shared/world.js');
const { convertFile } = require('../scripts/osm-to-town.js');
const { townData } = require('./towns.js');
const { N, TILE, K } = W;

const tileOf = (p) => [Math.floor(p.x / TILE), Math.floor(p.y / TILE)];

// Tiles under a road's centre-line, sampled every half tile (m.roads points are in pixels).
function tilesUnder(m, wanted) {
  const under = new Set();
  for (const r of m.roads) {
    if (!wanted(r)) continue;
    for (let i = 1; i < r.pts.length; i++) {
      const [x0, y0] = r.pts[i - 1], [x1, y1] = r.pts[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (TILE / 2)));
      for (let s = 0; s <= steps; s++) {
        const tx = Math.floor((x0 + ((x1 - x0) * s) / steps) / TILE), ty = Math.floor((y0 + ((y1 - y0) * s) / steps) / TILE);
        if (tx >= 0 && ty >= 0 && tx < N && ty < N) under.add(ty * N + tx);
      }
    }
  }
  return under;
}

test('Pulivendula has bridges where major roads cross water', () => {
  const m = W.buildTown(townData('pulivendula'));
  let bridges = 0;
  for (let i = 0; i < N * N; i++) if (m.t[i] === K.BRIDGE) bridges++;
  assert.ok(bridges >= 1, 'at least one bridge tile');
  const under = tilesUnder(m, (r) => ['trunk', 'primary', 'secondary', 'tertiary'].includes(r.class));
  assert.ok(under.size > 50, 'the town has major roads');
  for (const i of under) assert.notEqual(m.t[i], K.WATER, `water under a major road at ${i % N},${(i / N) | 0}`);
});

test('no building or wall lies under a major road', () => {
  const m = W.buildTown(townData('pulivendula'));
  const under = tilesUnder(m, (r) => r.w >= 2);
  assert.ok(under.size > 50, 'the town has roads at least two tiles wide');
  for (const i of under) assert.ok(m.t[i] !== K.BUILD && m.t[i] !== K.WALL, `kind ${m.t[i]} under a major road at ${i % N},${(i / N) | 0}`);
});

test('a sparsely mapped town still gets five reachable document shops and a BLO tent', () => {
  const data = convertFile(path.join(__dirname, 'fixtures', 'mini.osm'), { centre: [14.4, 78.2], size: 500 });
  const m = W.buildTown(data);
  assert.equal(m.docSites.length, W.DOC_SHOPS.length);
  assert.ok(m.blo, 'BLO tent');
  const f = W.field(m, [tileOf(m.start)]);
  for (const s of [...m.docSites, m.blo]) {
    const [tx, ty] = tileOf(s);
    assert.ok(!W.solidAt(m, tx, ty) && f[ty * N + tx] >= 0, `${s.name} is clear and reachable`);
  }
});
