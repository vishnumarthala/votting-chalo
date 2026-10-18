'use strict';
// A mapped bus station keeps its real position in every real town (D-19): a bus stand stands within 3 tiles of it.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../shared/world.js');
const { townData } = require('./towns.js');
const { N, TILE } = W;

const REAL_TOWNS = ['pulivendula', 'kadapa', 'punganur'];

// Distance in tiles from a mapped point (metres in the town file) to the nearest edge of a building (pixels). A station mapped
// on a junction has pavement all round it, so no building can have its middle there; the stand has to be beside it.
const toBuilding = (data, p, b) => {
  const px = (p.x * N) / data.size, py = (p.y * N) / data.size, x0 = b.x / TILE, y0 = b.y / TILE;
  return Math.hypot(Math.max(x0 - px, 0, px - (x0 + b.w / TILE)), Math.max(y0 - py, 0, py - (y0 + b.h / TILE)));
};

for (const id of REAL_TOWNS) {
  test(`T-6 ${id} has a bus stand within 3 tiles of its mapped bus station`, () => {
    const data = townData(id), m = W.buildTown(data);
    const stations = data.landmarks.filter((l) => l.kind === 'bus_station'), stands = m.buildings.filter((b) => b.kind === 'busstand');
    assert.ok(stations.length >= 1, 'the export maps a bus station inside the square');
    assert.ok(stations.some((p) => stands.some((b) => toBuilding(data, p, b) <= 3)),
      `no bus stand within 3 tiles of ${stations.map((p) => p.name).join(' / ')}; stands: ${stands.map((b) => `${b.name} at ${stations.map((p) => toBuilding(data, p, b).toFixed(1)).join('/')}`).join(' / ')}`);
  });
}
